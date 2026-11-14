/**
 * Load notebook plugins and release their registrations with an Effect scope.
 *
 * @module
 */
import { Cause, Effect, Exit, Scope } from "effect";
import { Atom, AtomRegistry } from "effect/reactivity";
import type { Plugin, View, Context } from "@moku/plugin";

/** A view registered by a plugin, with its host-wide identity. */
export interface RegisteredView extends View {
  /** Encoded plugin and view IDs separated by a slash. */
  readonly key: string;
  /** The plugin that owns this registration. */
  readonly pluginId: string;
}
/** A plugin that could not be loaded. */
export interface Failure {
  /** The plugin whose activation failed or whose ID was duplicated. */
  readonly pluginId: string;
  /** The activation failure formatted for display. */
  readonly message: string;
}
/** Registered views and activation failures for the loaded plugins. */
export interface State {
  /** Views in registration order; failed plugins leave no registrations. */
  readonly views: readonly RegisteredView[];
  /** Failures do not prevent other plugins from loading. */
  readonly failures: readonly Failure[];
}

/** A collection of plugins owned by one Effect scope. */
export interface Interface {
  /** Read-only state in the atom registry supplied to {@link load}. */
  readonly state: Atom.Atom<State>;
}

/**
 * Load plugins in order and acquire their registrations and resources.
 *
 * Each plugin has its own child scope. Failed activation closes that scope and
 * removes its registrations; closing the host scope releases every plugin.
 * Duplicate plugin IDs are reported without running the duplicate's setup.
 *
 */
export function load<const P extends readonly Plugin.Plugin<unknown>[]>(
  plugins: P,
): Effect.Effect<
  Interface,
  never,
  | Effect.Services<ReturnType<P[number]["effect"]>>
  | AtomRegistry.AtomRegistry
  | Scope.Scope
>;
export function load<R>(plugins: readonly Plugin.Plugin<R>[]) {
  return loadPlugins(plugins);
}
const loadPlugins = Effect.fnUntraced(function* <R>(
  plugins: readonly Plugin.Plugin<R>[],
): Effect.fn.Return<Interface, never, R | AtomRegistry.AtomRegistry | Scope.Scope> {
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
    const context: Context = {
      view: {
        add: (view) =>
          Effect.acquireRelease(
            Effect.sync(() => {
              if (closed) throw new Error("This plugin has been unloaded.");
              if (!view.id.trim()) throw new Error("A view needs an ID.");
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
        Effect.onExit((exit) =>
          Exit.isFailure(exit) ? Scope.close(scope, exit) : Effect.void,
        ),
      ),
    );
    if (Exit.isFailure(result)) {
      if (Cause.hasInterrupts(result.cause)) return yield* Effect.interrupt;
      fail(plugin.id, Cause.pretty(result.cause));
    }
  }
  return { state: Atom.readable((get) => get(state)) };
});
