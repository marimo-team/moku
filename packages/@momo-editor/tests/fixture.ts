import { onTestFinished } from "vite-plus/test";
import { Context, Effect, Exit, Layer, Scope } from "effect";
import { Atom, AtomRegistry } from "effect/reactivity";
import type { Observation } from "@momo/model";
import * as Protocol from "@momo/model/Protocol";
import * as Notebook from "@momo/model/Notebook";
import * as Document from "../src/Document.ts";

export const cell = Protocol.Cell.parse({
  id: "a",
  notebook_id: "n",
  code: "x = 1",
  name: "_",
  config: { column: null, disabled: false, hide_code: false, expand_output: false },
  etag: "cell-v1",
  code_fingerprint: "code-1",
  version: 1,
});
export const document = Protocol.Document.parse({
  notebook_id: "n",
  order: ["a"],
  app_config: {},
  etag: "doc-1",
  saved_etag: "doc-1",
  order_etag: "order-1",
  app_config_etag: "config-1",
  version: 1,
});
export function confirmed(code = cell.code!, version = 1): Notebook.Confirmed {
  const record = Protocol.Cell.parse({
    ...cell,
    code,
    version,
    etag: `cell-v${version}`,
  });
  return {
    revision: { ...document, etag: `doc-${version}`, version },
    cells: new Map([[cell.id, record]]),
  };
}
export async function setup(edit?: Notebook.Interface["edit"]) {
  const registry = AtomRegistry.make();
  const source = Atom.make<Notebook.Source>({ document: confirmed(), canEdit: true });
  const calls: {
    request: Protocol.EditRequest;
    key: string;
    respond: (version: number) => void;
  }[] = [];
  const unused = () => Effect.die("Unexpected notebook operation");
  const notebook: Notebook.Interface = {
    target: { connectionId: "host", notebookId: "n" },
    source,
    state: Atom.make((): Observation<Notebook.Snapshot> => {
      throw new Error("Unexpected notebook state read");
    }),
    edit:
      edit ??
      (({ request, requestId: key }) =>
        Effect.callback((resume) => {
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
        })),
    save: unused,
    start: unused,
    run: unused,
    interrupt: unused,
    cancel: unused,
    stop: unused,
  };
  const scope = Effect.runSync(Scope.make());
  const make = () =>
    Effect.runPromise(
      Layer.buildWithScope(Document.layer, scope).pipe(
        Effect.map((context) => Context.get(context, Document.Service)),
        Effect.provideService(Notebook.Service, notebook),
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
  onTestFinished(async () => {
    await close();
    registry.dispose();
  });
  const change = (code: string) =>
    registry.set(model.edit, (tx) => tx.setCode(cell.id, code));
  const code = () => registry.get(model.document)?.cells.get(cell.id)?.code;
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
