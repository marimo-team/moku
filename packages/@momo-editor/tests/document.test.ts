import { expect, test, vi } from "vite-plus/test";
import { Effect } from "effect";
import * as Protocol from "@momo/model/Protocol";
import { RequestError } from "@momo/model";
import * as Document from "../src/Document.ts";
import { setup, confirmed } from "./fixture.ts";
import { cell, document } from "./fixture.ts";

for (const ordering of ["response-first", "stream-first"]) {
  test(`keeps newer typing through acknowledgment (${ordering})`, async () => {
    const h = await setup();
    h.change("first");
    expect(h.code()).toBe("first");
    const flushed = Effect.runPromise(h.model.flush);
    await vi.waitFor(() => expect(h.calls).toHaveLength(1));
    h.change("second");
    if (ordering === "response-first") {
      h.calls[0].respond(2);
      await Promise.resolve();
      expect(h.code()).toBe("second");
      h.publish("first", 2);
    } else {
      h.publish("first", 2);
      expect(h.code()).toBe("second");
      h.calls[0].respond(2);
    }
    await vi.waitFor(() => expect(h.calls).toHaveLength(2));
    expect(h.calls[1].request.changes[0]).toMatchObject({
      kind: "put_cell",
      base_etag: "cell-v2",
      cell: { code: "second" },
    });
    h.calls[1].respond(3);
    h.publish("second", 3);
    expect((await flushed).cells.get(cell.id)?.etag).toBe("cell-v3");
    expect(h.registry.get(h.model.dirty)).toBe(false);
    h.publish("external", 4);
    expect(h.code()).toBe("external");
  });
}

test("flush callers share one immutable submission", async () => {
  const h = await setup();
  h.change("edited");
  const a = Effect.runPromise(h.model.flush);
  const b = Effect.runPromise(h.model.flush);
  await vi.waitFor(() => expect(h.calls).toHaveLength(1));
  h.calls[0].respond(2);
  h.publish("edited", 2);
  const [one, two] = await Promise.all([a, b]);
  expect(one).toBe(two);
  expect(h.calls).toHaveLength(1);
});

test("transactions roll back, reject async callbacks, and cannot escape", async () => {
  const h = await setup();
  let escaped: Document.Editor | undefined;
  expect(() =>
    h.registry.set(h.model.edit, (tx) => {
      tx.setCode(cell.id, "discard");
      throw new Error("rollback");
    }),
  ).toThrow("rollback");
  expect(h.code()).toBe(cell.code);
  expect(() =>
    h.registry.set(h.model.edit, async (tx) => {
      tx.setCode(cell.id, "discard");
    }),
  ).toThrow("synchronous");
  h.registry.set(h.model.edit, (tx) => {
    escaped = tx;
  });
  expect(() => escaped!.setCode(cell.id, "late")).toThrow("ended");
  expect(h.code()).toBe(cell.code);
});

test("insertion is immediate and deleting an unsent creation needs no host request", async () => {
  const h = await setup();
  const id = "new-cell";
  h.registry.set(h.model.edit, (tx) =>
    tx.createCell({ id, code: "" }, { before: cell.id }),
  );
  expect(h.registry.get(h.model.document)?.order).toEqual([id, cell.id]);
  h.registry.set(h.model.edit, (tx) => tx.deleteCell(id));
  await Effect.runPromise(h.model.flush);
  expect(h.calls).toHaveLength(0);
  expect(h.registry.get(h.model.document)?.order).toEqual([cell.id]);
});

test("retains a draft across reset and retries against a complete snapshot", async () => {
  const h = await setup();
  h.change("local");
  h.registry.set(h.source, { document: null, canEdit: false });
  expect(h.registry.get(h.model.document)).toBeNull();
  h.publish("remote", 2);
  expect(h.code()).toBe("local");
  const flushed = Effect.runPromise(h.model.flush);
  await vi.waitFor(() => expect(h.calls).toHaveLength(1));
  expect(h.calls[0].request.changes[0]).toMatchObject({ base_etag: "cell-v2" });
  h.publish("local", 3);
  h.calls[0].respond(3);
  await flushed;
});

test("a host rejection preserves typing; explicit retry uses fresh preconditions", async () => {
  const attempts: { request: Protocol.EditRequest; key: string }[] = [];
  const rejection = Protocol.PreconditionFailedProblem.parse({
    type: "urn:marimo:problem:precondition-failed",
    index: 0,
    cell,
    document: { ...document, version: 2 },
  });
  const h = await setup(({ request, requestId: key }) => {
    attempts.push({ request, key });
    return attempts.length === 1
      ? Effect.fail(
          new RequestError({
            message: rejection.title,
            status: 412,
            problem: rejection,
          }),
        )
      : Effect.succeed({ document: { ...document, version: 3 }, cells: {} });
  });
  h.change("local");
  await expect(Effect.runPromise(h.model.flush)).rejects.toBeDefined();
  expect(h.code()).toBe("local");
  await expect(Effect.runPromise(h.model.retry)).rejects.toThrow("Wait for the host");
  expect(attempts).toHaveLength(1);
  h.publish("external", 2);
  const retry = Effect.runPromise(h.model.retry);
  await vi.waitFor(() => expect(attempts).toHaveLength(2));
  expect(attempts[1].key).not.toBe(attempts[0].key);
  expect(attempts[1].request.changes[0]).toMatchObject({
    base_etag: "cell-v2",
    cell: { code: "local" },
  });
  h.publish("local", 3);
  await retry;
});

test("lost responses reuse the exact request and key without losing new typing", async () => {
  const attempts: { request: Protocol.EditRequest; key: string }[] = [];
  const h = await setup(({ request, requestId: key }) => {
    attempts.push({ request, key });
    return attempts.length === 1
      ? Effect.fail(new RequestError({ message: "Connection lost" }))
      : Effect.succeed({
          document: { ...document, version: attempts.length === 2 ? 2 : 3 },
          cells: {},
        });
  });
  h.change("first");
  const flushed = Effect.runPromise(h.model.flush);
  await vi.waitFor(() => expect(attempts).toHaveLength(1));
  h.publish("first", 2);
  h.change("second");
  await vi.waitFor(() => expect(attempts).toHaveLength(3));
  expect(attempts[1].request).toBe(attempts[0].request);
  expect(attempts[1].key).toBe(attempts[0].key);
  expect(attempts[2].key).not.toBe(attempts[0].key);
  expect(attempts[2].request.changes[0]).toMatchObject({
    cell: { code: "second" },
  });
  h.publish("second", 3);
  await flushed;
});

test("scope closure interrupts an in-flight request and releases its flush caller", async () => {
  const h = await setup();
  h.change("local");
  const flushed = Effect.runPromiseExit(h.model.flush);
  await vi.waitFor(() => expect(h.calls).toHaveLength(1));
  await h.close();
  expect((await flushed)._tag).toBe("Failure");
  h.calls[0].respond(2);
});

test("closing before debounce prevents a write and releases flush callers", async () => {
  const h = await setup();
  h.change("local");
  await h.close();
  await new Promise((resolve) => setTimeout(resolve, 450));
  expect(h.calls).toHaveLength(0);
  await expect(Effect.runPromise(h.model.flush)).rejects.toThrow("closed");
});

test("withheld source and permission changes cannot publish edits", async () => {
  const h = await setup();
  h.registry.set(h.source, { document: confirmed(), canEdit: false });
  h.change("forbidden");
  expect(h.code()).toBe(cell.code);
  h.registry.set(h.source, {
    document: {
      revision: document,
      cells: new Map([[cell.id, { ...cell, code: null }]]),
    },
    canEdit: true,
  });
  h.registry.set(h.model.edit, (tx) => tx.setName(cell.id, "renamed"));
  await expect(Effect.runPromise(h.model.flush)).rejects.toThrow("unavailable");
  expect(h.calls).toHaveLength(0);
});

test("configuration patches preserve omitted settings and remote changes to other fields", async () => {
  const h = await setup();
  const original = confirmed();
  h.registry.set(h.source, {
    document: {
      ...original,
      cells: new Map([
        [cell.id, { ...cell, config: { ...cell.config, disabled: true } }],
      ]),
    },
    canEdit: true,
  });
  h.registry.set(h.model.edit, (tx) => tx.updateConfig(cell.id, { hide_code: true }));
  expect(h.registry.get(h.model.document)?.cells.get(cell.id)?.config).toMatchObject({
    disabled: true,
    hide_code: true,
  });
  const remote = confirmed(cell.code!, 2);
  h.registry.set(h.source, {
    document: {
      ...remote,
      cells: new Map([
        [
          cell.id,
          {
            ...remote.cells.get(cell.id)!,
            name: "remote",
            config: { ...cell.config, disabled: true, expand_output: true },
          },
        ],
      ]),
    },
    canEdit: true,
  });
  const flushing = Effect.runPromise(h.model.flush);
  await vi.waitFor(() => expect(h.calls).toHaveLength(1));
  expect(h.calls[0].request.changes[0]).toMatchObject({
    kind: "put_cell",
    base_etag: "cell-v2",
    cell: {
      name: "remote",
      config: { disabled: true, hide_code: true, expand_output: true },
    },
  });
  h.calls[0].respond(3);
  h.publish(cell.code!, 3);
  await flushing;
});

test("a single transaction creates, removes, and orders cells atomically", async () => {
  const h = await setup();
  h.registry.set(h.model.edit, (tx) => {
    tx.createCell({ id: "b", code: "b = 2" }, { after: cell.id });
    tx.createCell({ id: "c", code: "c = 3" });
    tx.deleteCell(cell.id);
    tx.setOrder(["c", "b"]);
  });
  expect(h.registry.get(h.model.document)?.order).toEqual(["c", "b"]);
  const flushing = Effect.runPromise(h.model.flush);
  await vi.waitFor(() => expect(h.calls).toHaveLength(1));
  const request = h.calls[0].request;
  expect(Protocol.EditRequest.safeParse(request).success).toBe(true);
  expect(request.changes.map((change) => change.kind)).toEqual([
    "put_cell",
    "put_cell",
    "delete_cell",
    "set_order",
  ]);
  expect(request.changes.at(-1)).toEqual({
    kind: "set_order",
    base_etag: "order-1",
    order: ["c", "b"],
  });
  h.calls[0].respond(2);
  h.registry.set(h.source, {
    canEdit: true,
    document: {
      revision: { ...document, version: 2, order: ["c", "b"] },
      cells: new Map(
        ["b", "c"].map((id) => [
          id,
          {
            ...cell,
            id,
            code: `${id} = ${id === "b" ? 2 : 3}`,
            version: 2,
            etag: `${id}-2`,
          },
        ]),
      ),
    },
  });
  await flushing;
  expect(h.registry.get(h.model.dirty)).toBe(false);
});

test("deleting an in-flight creation waits for its acknowledgment before sending the delete", async () => {
  const h = await setup();
  h.registry.set(h.model.edit, (tx) => tx.createCell({ id: "b", code: "b = 2" }));
  const flushing = Effect.runPromise(h.model.flush);
  await vi.waitFor(() => expect(h.calls).toHaveLength(1));
  h.registry.set(h.model.edit, (tx) => tx.deleteCell("b"));
  h.registry.set(h.source, {
    canEdit: true,
    document: {
      revision: { ...document, version: 2, order: ["a", "b"] },
      cells: new Map([
        ["a", cell],
        ["b", { ...cell, id: "b", code: "b = 2", version: 2, etag: "b-2" }],
      ]),
    },
  });
  expect(h.registry.get(h.model.document)?.order).toEqual(["a"]);
  h.calls[0].respond(2);
  await vi.waitFor(() => expect(h.calls).toHaveLength(2));
  expect(h.calls[1].request.changes).toEqual([
    { kind: "delete_cell", id: "b", base_etag: "b-2" },
  ]);
  h.calls[1].respond(3);
  h.publish(cell.code!, 3);
  await flushing;
  expect(h.registry.get(h.model.dirty)).toBe(false);
});

test("separate documents keep separate drafts over the same notebook", async () => {
  const h = await setup();
  const other = await h.make();
  h.change("first draft");
  h.registry.set(other.edit, (tx) => tx.setName(cell.id, "second_draft"));
  expect(h.code()).toBe("first draft");
  expect(h.registry.get(other.document)?.cells.get(cell.id)).toMatchObject({
    code: cell.code,
    name: "second_draft",
  });
  h.publish("remote", 2);
  expect(h.code()).toBe("first draft");
  expect(h.registry.get(other.document)?.cells.get(cell.id)).toMatchObject({
    code: "remote",
    name: "second_draft",
  });
});

test("autosynchronization sends the latest draft after typing settles", async () => {
  const h = await setup();
  h.change("first");
  h.change("latest");
  expect(h.calls).toHaveLength(0);
  await vi.waitFor(() => expect(h.calls).toHaveLength(1), { timeout: 1500 });
  expect(h.calls[0].request.changes[0]).toMatchObject({ cell: { code: "latest" } });
  h.calls[0].respond(2);
  h.publish("latest", 2);
  await vi.waitFor(() => expect(h.registry.get(h.model.dirty)).toBe(false));
  expect(h.registry.get(h.model.status)).toEqual({ status: "idle" });
});
