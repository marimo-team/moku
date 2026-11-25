import * as Vitest from "vite-plus/test";
import * as Protocol from "@marimo-team/client/protocol";
import * as Connection from "../src/connection.ts";

Vitest.test(
  "the snapshot uses valid pinned protocol messages and complete document references",
  () => {
    for (const message of Connection.snapshot) {
      Vitest.expect(Protocol.Event.parse(message)).toEqual(message);
    }
    const scene = Connection.sceneAt(Connection.steps.length - 1);
    const cells = scene.received.flatMap((message) =>
      message.event === "cell" ? [message.data.cell] : [],
    );
    const document = scene.received.find((message) => message.event === "document")
      ?.data.document;
    Vitest.expect(document?.order).toEqual(cells.map((cell) => cell.id));
    Vitest.expect(
      cells.every(
        (cell) =>
          cell.notebook_id === document?.notebook_id &&
          cell.version <= document.version,
      ),
    ).toBe(true);
  },
);

Vitest.test(
  "complete record delivery alone does not publish the snapshot or provide a cursor",
  () => {
    const beforeReady =
      Connection.steps.findIndex((step) => step.message?.event === "ready") - 1;
    const staging = Connection.sceneAt(beforeReady);
    Vitest.expect(staging.received).toHaveLength(4);
    Vitest.expect(staging.ready).toBe(false);
    Vitest.expect(staging.cursor).toBeNull();
    const ready = Connection.sceneAt(beforeReady + 1);
    Vitest.expect(ready.received).toEqual(staging.received);
    Vitest.expect(ready.ready).toBe(true);
    Vitest.expect(ready.cursor).toBe("snapshot:7fa2");
  },
);

Vitest.test(
  "rewinding drops future records and replay reconstructs the same replica",
  () => {
    const complete = Connection.sceneAt(Connection.steps.length - 1);
    const cellStep = Connection.steps.findIndex(
      (step) => step.message?.event === "cell",
    );
    const rewind = Connection.sceneAt(cellStep);
    Vitest.expect(rewind.received.map(Connection.recordKey)).toEqual([
      "notebook:n1",
      "cell:c1",
    ]);
    Vitest.expect(rewind.ready).toBe(false);
    Vitest.expect(rewind.cursor).toBeNull();
    Vitest.expect(Connection.sceneAt(0).received).toEqual([]);
    Vitest.expect(Connection.sceneAt(0).hostLoaded).toBe(false);
    Vitest.expect(Connection.sceneAt(Connection.steps.length - 1)).toEqual(complete);
  },
);

Vitest.test("the host can own all objects before the client receives any", () => {
  const loaded = Connection.sceneAt(
    Connection.steps.findIndex((step) => step.breakpoint),
  );
  Vitest.expect(loaded.hostLoaded).toBe(true);
  Vitest.expect(loaded.received).toEqual([]);
  Vitest.expect(loaded.delivered).toEqual([]);
});

Vitest.test("SSE inspector frames preserve payloads and the ready cursor", () => {
  for (const message of Connection.snapshot) {
    const lines = Connection.frame(message).trimEnd().split("\n");
    Vitest.expect(lines).toContain(`event: ${message.event}`);
    const data = lines.find((line) => line.startsWith("data: "));
    Vitest.expect(JSON.parse(data?.slice(6) ?? "null")).toEqual(message.data);
    if (message.id) Vitest.expect(lines).toContain(`id: ${message.id}`);
    else Vitest.expect(lines.some((line) => line.startsWith("id:"))).toBe(false);
  }
});

Vitest.test(
  "parsing constructs the complete host notebook before any events are sent",
  () => {
    const parse = Connection.steps.findIndex((step) => step.created);
    const parsing = Connection.sceneAt(parse - 0.01);
    Vitest.expect(parsing.hostRecords).toEqual([]);
    Vitest.expect(Connection.transitAt(parse - 0.01)?.kind).toBe("load");
    Vitest.expect(parsing.delivered).toEqual([]);
    const parsed = Connection.sceneAt(parse);
    Vitest.expect(parsed.hostRecords).toEqual(Connection.initialRecords);
    Vitest.expect(parsed.received).toEqual([]);
    Vitest.expect(parsed.delivered).toEqual([]);
    const firstSend = Connection.sceneAt(parse + 0.5);
    Vitest.expect(firstSend.hostRecords).toEqual(parsed.hostRecords);
    Vitest.expect(firstSend.received).toEqual([]);
    Vitest.expect(Connection.transitAt(parse + 0.5)?.kind).toBe("event");
  },
);

Vitest.test(
  "events exist in transit, disappear on arrival, and leave the host's objects intact",
  () => {
    const send = Connection.steps.findIndex((step) => step.message?.event === "cell");
    const inFlight = Connection.sceneAt(send - 0.5);
    const transit = Connection.transitAt(send - 0.5);
    Vitest.expect(transit?.kind).toBe("event");
    Vitest.expect(inFlight.received).toHaveLength(1);
    Vitest.expect(inFlight.hostRecords).toHaveLength(4);
    const arrived = Connection.sceneAt(send);
    Vitest.expect(Connection.transitAt(send)).toBeNull();
    Vitest.expect(arrived.received).toHaveLength(2);
    Vitest.expect(arrived.hostRecords).toEqual(inFlight.hostRecords);
    Vitest.expect(Connection.sceneAt(send - 0.5)).toEqual(inFlight);
    Vitest.expect(Connection.transitAt(send - 0.5)).toEqual(transit);
  },
);

Vitest.test("the request precedes an open response that outlives the snapshot", () => {
  Vitest.expect(Connection.transitAt(0.5)?.kind).toBe("request");
  Vitest.expect(Connection.sceneAt(1).connectionOpen).toBe(false);
  Vitest.expect(Connection.transitAt(1.5)?.kind).toBe("open");
  Vitest.expect(Connection.sceneAt(2).connectionOpen).toBe(true);
  Vitest.expect(Connection.sceneAt(2).received).toEqual([]);
  const complete = Connection.sceneAt(Connection.steps.length - 1);
  Vitest.expect(complete.ready).toBe(true);
  Vitest.expect(complete.connectionOpen).toBe(true);
  Vitest.expect(Connection.transitAt(Connection.steps.length - 1)).toBeNull();
});
