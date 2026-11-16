import { Schema } from "effect";
import * as Vitest from "vite-plus/test";
import { Context, Effect, Exit, Layer, Scope } from "effect";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";
import * as Protocol from "@moku/core/Protocol";
import * as Notebook from "@moku/core/Notebook";
import { emptyState } from "../../@moku-core/tests/fixtures.ts";
import type { Source } from "../src/internal/state.ts";
import * as Host from "@moku/core/Host";
import { FetchHttpClient } from "effect/http";
import * as Document from "../src/Document.ts";

export const cell = Schema.decodeUnknownSync(Protocol.Cell)({
  id: "a",
  notebook_id: "n",
  code: "x = 1",
  name: "_",
  config: { column: null, disabled: false, hide_code: false, expand_output: false },
  etag: "cell-v1",
  code_fingerprint: "code-1",
  version: 1,
});
export const document = Schema.decodeUnknownSync(Protocol.Document)({
  notebook_id: "n",
  order: ["a"],
  app_config: {},
  etag: "doc-1",
  saved_etag: "doc-1",
  order_etag: "order-1",
  app_config_etag: "config-1",
  version: 1,
});
export function confirmed(code = cell.code!, version = 1): Notebook.Document {
  const record = Schema.decodeUnknownSync(Protocol.Cell)({
    ...cell,
    code,
    version,
    etag: `cell-v${version}`,
  });
  return {
    ...Schema.decodeUnknownSync(Protocol.Document)({
      ...document,
      etag: `doc-${version}`,
      version,
    }),
    cells: [record],
  };
}
export async function setup(
  edit?: (input: {
    request: typeof Protocol.EditRequest.Type;
    requestId: string;
  }) => Effect.Effect<unknown, unknown>,
  options: Pick<Host.Options, "retryWindow"> = {},
) {
  const registry = AtomRegistry.make();
  const source = Atom.make<Source>({ document: confirmed(), canEdit: true });
  const calls: {
    request: typeof Protocol.EditRequest.Type;
    key: string;
    respond: (version: number) => void;
  }[] = [];
  const scope = Effect.runSync(Scope.make());
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    if (request.url.endsWith("/events"))
      return new Response(new ReadableStream(), {
        headers: { "Content-Type": "text/event-stream" },
      });
    if (!request.url.endsWith("/edits"))
      throw new Error(`Unexpected request: ${request.url}`);
    const payload = Schema.decodeUnknownSync(Protocol.EditRequest)(
      await request.json(),
    );
    const key = request.headers.get("idempotency-key")!;
    const operation = edit
      ? edit({ request: payload, requestId: key })
      : Effect.callback<unknown>((resume) => {
          calls.push({
            request: payload,
            key,
            respond: (version) =>
              resume(
                Effect.succeed({
                  document: { ...document, etag: `doc-${version}`, version },
                  cells: {},
                }),
              ),
          });
        });
    return Effect.runPromise(
      operation.pipe(
        Effect.match({
          onSuccess: (body) => Response.json(body),
          onFailure: (cause) => {
            const problem = Schema.decodeUnknownOption(
              Schema.Union([Protocol.Problem, Protocol.UnknownProblem]),
            )(cause);
            if (problem._tag === "Some")
              return Response.json(problem.value, {
                status: problem.value.status,
                headers: { "Content-Type": "application/problem+json" },
              });
            throw cause;
          },
        }),
      ),
      { signal: request.signal },
    );
  };
  const host = await Effect.runPromise(
    Host.make({ baseUrl: "http://host.test", ...options }).pipe(
      Effect.provide(FetchHttpClient.layer),
      Effect.provideService(FetchHttpClient.Fetch, fetch),
      Effect.provideService(AtomRegistry.AtomRegistry, registry),
      Effect.provideService(Scope.Scope, scope),
    ),
  );
  const attached = await Effect.runPromise(
    host.notebooks.attach("n").pipe(Effect.provideService(Scope.Scope, scope)),
  );
  // Draft tests control source synchronously; commands still cross the real HTTP client.
  const notebook: Notebook.Interface = {
    ...attached,
    state: Atom.readable((get) => {
      const sourceValue = get(source);
      return AsyncResult.success({
        ...emptyState(),
        notebook: Schema.decodeUnknownSync(Protocol.Notebook)({
          id: "n",
          project_id: "p",
          path: "n.py",
          name: "n.py",
          updated_at: null,
          operations: sourceValue.canEdit ? ["notebook.edit"] : [],
        }),
        document: sourceValue.document,
      });
    }),
  };
  const make = () =>
    Effect.runPromise(
      Layer.buildWithScope(Document.layer(notebook), scope).pipe(
        Effect.map((context) => Context.get(context, Document.Service)),
        Effect.provideService(AtomRegistry.AtomRegistry, registry),
        Effect.provideService(Scope.Scope, scope),
      ),
    );
  const model = await make();
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await Effect.runPromise(Scope.close(scope, Exit.void));
  };
  Vitest.onTestFinished(async () => {
    await close();
    registry.dispose();
  });
  const change = (code: string) => model.edit((tx) => tx.setCode(cell.id, code));
  const code = () => registry.get(model.state).document?.cells.get(cell.id)?.code;
  const publish = (code: string, version: number) =>
    registry.set(source, { document: confirmed(code, version), canEdit: true });
  return {
    registry,
    source,
    model,
    notebook,
    make,
    calls,
    close,
    change,
    code,
    publish,
  };
}
