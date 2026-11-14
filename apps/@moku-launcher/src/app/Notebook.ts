/** Compose a notebook model with launcher identity and native outputs. @module */
import { Effect, Layer } from "effect";
import type * as Model from "@moku/core/Notebook";
import * as Host from "@moku/core/Host";
import type * as Interaction from "@moku/core/Interaction";
import type * as Proxy from "./Proxy.ts";
import * as NativeOutputs from "./native/interactions.ts";

/** A notebook selected through a launcher host connection. */
export interface Target {
  readonly connectionId: string;
  readonly notebookId: string;
}

/** The complete notebook supplied to launcher views. */
export interface Interface extends Model.Interface {
  readonly target: Target;
  readonly runtime: Model.Interface["runtime"] & Interaction.Interface;
}

/** Acquire the model and output connection in the same scope. */
export const make = Effect.fnUntraced(function* (proxy: Proxy.Proxy, input: Target) {
  const target = Object.freeze({ ...input });
  const transport = yield* Layer.build(proxy.http);
  const host = yield* Host.make({
    baseUrl: proxy.url(`/api/hosts/${encodeURIComponent(target.connectionId)}`),
  }).pipe(Effect.provideContext(transport));
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
  return {
    ...notebook,
    target,
    runtime: { ...notebook.runtime, ...outputs },
  } satisfies Interface;
});
