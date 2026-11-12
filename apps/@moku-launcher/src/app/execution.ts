/** Start a notebook kernel and wait until it can accept work. @module */
import { Effect } from "effect";
import { AtomRegistry } from "effect/reactivity";
import type * as Notebook from "@moku/core/Notebook";

/** Returns false if startup was cancelled or the runtime was removed. */
export function ensureRuntime(notebook: Notebook.Interface) {
  return Effect.gen(function* () {
    const registry = yield* AtomRegistry.AtomRegistry;
    const current = registry.get(notebook.state).value.runtime;
    if (current?.status === "running") return true;
    const started =
      current?.status === "starting"
        ? current
        : yield* notebook.runtime.start({ requestId: crypto.randomUUID() });
    if (started.status === "running") return true;
    return yield* Effect.callback<boolean, Error>((resume) => {
      let seen = false;
      const unsubscribe = registry.subscribe(
        notebook.state,
        (state) => {
          if (state.error) {
            resume(Effect.fail(state.error));
            return;
          }
          const runtime = state.value.runtime;
          if (runtime?.id === started.id) {
            seen = true;
            if (runtime.status === "running") resume(Effect.succeed(true));
            else if (runtime.status === "terminating") resume(Effect.succeed(false));
            else if (runtime.status !== "starting")
              resume(
                Effect.fail(
                  new Error(runtime.message ?? "The runtime could not start."),
                ),
              );
          } else if (seen && state.value.ready) resume(Effect.succeed(false));
        },
        { immediate: true },
      );
      return Effect.sync(unsubscribe);
    });
  }).pipe(Effect.timeout("60 seconds"));
}
