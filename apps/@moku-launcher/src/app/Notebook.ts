/** Compose a notebook model with launcher identity and native outputs. @module */
import { Deferred, Effect, Stream } from "effect";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";
import type * as Model from "@moku/core/Notebook";
import type * as Host from "@moku/core/Host";
import { operation } from "@moku/core/internal/comm-protocol";
import type * as Comm from "@moku/core/experimental/Comm";
import type * as Proxy from "./Proxy.ts";
import * as NativeOutputs from "./native/comm.ts";

/** A notebook selected through a launcher host connection. */
export interface Target {
  readonly connectionId: string;
  readonly notebookId: string;
}

/** The complete notebook supplied to launcher views. */
export interface Interface extends Model.Interface {
  readonly target: Target;
  /** Resolves native output assets for the renderer. */
  readonly assetUrl: (path: string) => string;
}

/** Acquire the model and output connection in the same scope. */
export const make = Effect.fnUntraced(function* (
  proxy: Proxy.Interface,
  host: Host.Interface,
  input: Target,
) {
  const target = Object.freeze({ ...input });
  const notebook = yield* host.notebooks.attach(target.notebookId);
  const outputs = yield* NativeOutputs.make(
    {
      host,
      notebookId: target.notebookId,
      baseUrl: proxy.url(
        `/api/hosts/${encodeURIComponent(target.connectionId)}/marimo`,
      ),
      fetch: proxy.fetch,
    },
    notebook.state,
  );
  const registry = yield* AtomRegistry.AtomRegistry;
  const transport = Atom.readable((get) =>
    AsyncResult.getOrElse(
      get(notebook.state),
      () => undefined,
    )?.notebook?.operations.includes(operation)
      ? notebook.runtime.experimentalComm
      : outputs.comm,
  );
  const closed = yield* Deferred.make<void>();
  yield* Effect.addFinalizer(() => Deferred.succeed(closed, undefined));
  const comm: Comm.Interface = {
    state: Atom.readable((get) => get(get(transport).state)),
    events: AtomRegistry.toStream(registry, transport).pipe(
      Stream.switchMap((selected) => selected.events),
      Stream.interruptWhen(Deferred.await(closed)),
    ),
    send: (message) => Effect.suspend(() => registry.get(transport).send(message)),
    invoke: (input) => Effect.suspend(() => registry.get(transport).invoke(input)),
    retry: Effect.suspend(() => registry.get(transport).retry),
  };
  return {
    ...notebook,
    target,
    assetUrl: outputs.assetUrl,
    runtime: { ...notebook.runtime, experimentalComm: comm },
  } satisfies Interface;
});
