import { Cause, Effect, Exit, Scope } from "effect";
import { Atom, AtomRegistry } from "effect/reactivity";
import type { Plugin, View } from "@moku/plugin";

export interface RegisteredView extends View {
  readonly key: string;
  readonly pluginId: string;
}
export interface Failure {
  readonly pluginId: string;
  readonly message: string;
}
export interface State {
  readonly views: readonly RegisteredView[];
  readonly failures: readonly Failure[];
}

export const make = (plugins: readonly Plugin.Plugin[]) =>
  Effect.gen(function* () {
    const registry = yield* AtomRegistry.AtomRegistry;
    const owner = yield* Effect.scope;
    const state = Atom.make<State>({ views: [], failures: [] });
    yield* Atom.mount(state);
    const seen = new Set<string>();
    const fail = (pluginId: string, message: string) =>
      registry.update(state, (current) => ({
        ...current,
        failures: [...current.failures, { pluginId, message }],
      }));
    for (const plugin of plugins) {
      if (!plugin.id.trim() || seen.has(plugin.id)) {
        fail(plugin.id, `Plugin ID must be nonempty and unique: ${plugin.id}`);
        continue;
      }
      seen.add(plugin.id);
      const scope = yield* Scope.fork(owner);
      let closed = false;
      yield* Scope.addFinalizer(
        scope,
        Effect.sync(() => {
          closed = true;
        }),
      );
      const context: Plugin.Context = {
        view: {
          add: (view) =>
            Effect.acquireRelease(
              Effect.sync(() => {
                if (closed) throw new Error("This plugin has been unloaded.");
                if (!view.id.trim() || !view.title.trim())
                  throw new Error("A view needs an ID and title.");
                const key = `${encodeURIComponent(plugin.id)}/${encodeURIComponent(view.id)}`;
                if (registry.get(state).views.some((item) => item.key === key))
                  throw new Error(`View already registered: ${key}`);
                const entry: RegisteredView = { ...view, key, pluginId: plugin.id };
                registry.update(state, (current) => ({
                  ...current,
                  views: [...current.views, entry],
                }));
                return entry;
              }),
              (entry) =>
                Effect.sync(() =>
                  registry.update(state, (current) => ({
                    ...current,
                    views: current.views.filter((item) => item !== entry),
                  })),
                ),
            ).pipe(Effect.asVoid),
        },
      };
      const result = yield* Effect.exit(
        Effect.suspend(() => plugin.effect(context)).pipe(
          Effect.provideService(Scope.Scope, scope),
        ),
      );
      if (Exit.isFailure(result)) {
        yield* Scope.close(scope, result);
        fail(plugin.id, Cause.pretty(result.cause));
      }
    }
    return { state: Atom.readable((get) => get(state)) };
  });
