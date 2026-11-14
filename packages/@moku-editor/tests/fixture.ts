import { Schema } from "effect";
import * as Vitest from "vite-plus/test";
import { Context, Effect, Exit, Layer, Scope } from "effect";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";
import * as Protocol from "@moku/core/Protocol";
import * as Notebook from "@moku/core/Notebook";
import { emptyNotebook } from "../../@moku-core/src/notebook/state.ts";
import * as Source from "../src/internal/source.ts";
import * as Edit from "../../@moku-core/src/notebook/edit.ts";
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
export function confirmed(code = cell.code!, version = 1): Source.Confirmed {
  const record = Schema.decodeUnknownSync(Protocol.Cell)({
    ...cell,
    code,
    version,
    etag: `cell-v${version}`,
  });
  return {
    revision: Schema.decodeUnknownSync(Protocol.Document)({
      ...document,
      etag: `doc-${version}`,
      version,
    }),
    cells: new Map([[cell.id, record]]),
  };
}
export async function setup(
  edit?: (input: {
    request: Protocol.EditRequest;
    requestId: string;
  }) => Effect.Effect<unknown, unknown>,
) {
  const registry = AtomRegistry.make();
  const source = Atom.make<Source.Source>({ document: confirmed(), canEdit: true });
  const calls: {
    request: Protocol.EditRequest;
    key: string;
    respond: (version: number) => void;
  }[] = [];
  const unused = () => Effect.die("Unexpected notebook operation");
  const notebook: Notebook.Interface = {
    id: document.notebook_id,
    state: Atom.readable((get) => {
      const sourceValue = get(source);
      return AsyncResult.success({
        ...emptyNotebook(),
        notebook: Schema.decodeUnknownSync(Protocol.Notebook)({
          id: "n",
          project_id: "p",
          path: "n.py",
          name: "n.py",
          updated_at: null,
          operations: sourceValue.canEdit ? ["notebook.edit"] : [],
        }),
        document: sourceValue.document ? Source.document(sourceValue.document) : null,
      });
    }),
    ensureRunning: unused(),
    edit: (callback) => {
      const key = crypto.randomUUID();
      const request = Edit.build("n", new Set(), callback);
      const operation = edit
        ? Effect.suspend(() => edit({ request, requestId: key }))
        : Effect.callback<unknown>((resume) => {
            calls.push({
              request,
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
      return operation.pipe(
        Effect.catch((cause) => {
          const problem = Schema.decodeUnknownOption(Protocol.Problem)(cause);
          return Effect.fail(
            problem._tag === "Some"
              ? problem.value
              : new Notebook.ModelError({
                  reason: "invalid-state",
                  message: "Network failure.",
                }),
          );
        }),
        Effect.flatMap(Schema.decodeUnknownEffect(Protocol.EditResponse)),
        Effect.map(Edit.result),
      );
    },
    save: unused,
    runtime: {
      start: unused,
      restart: unused,
      execute: unused,
      reply: unused,
      run: unused,
      interrupt: unused,
      cancel: unused,
      stop: unused,
    },
  };
  const scope = Effect.runSync(Scope.make());
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
