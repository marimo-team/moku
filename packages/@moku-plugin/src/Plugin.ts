/**
 * Scoped registrations for notebook views.
 *
 * The host selects a notebook and supplies it to each view. Views of the same
 * notebook can share its observation and commands. Hosts render views in the
 * notebook's atom registry and provide native output interactions through
 * `@moku/outputs` when available.
 *
 * @module
 */
import type { Atom, AtomRegistry } from "effect/reactivity";
import type { Effect, Scope } from "effect";
import type * as React from "react";
import type * as Notebook from "@moku/core/Notebook";

/**
 * The notebook selected by the host for this view instance.
 */
export interface ViewProps {
  /** The notebook selected for this view instance. */
  readonly notebook: Notebook.Interface;
  /** The selected tab from this view's list. */
  readonly tab: Tab;
}

/** A tab offered by a notebook view. */
export interface Tab {
  /** Stable identity within this view. */
  readonly id: string;
  /** Label displayed by the application. */
  readonly title: string;
}
/** A registration contributing a changing list of notebook tabs. */
export interface View {
  /** Stable identity within the plugin. */
  readonly id: string;
  /** Tabs available to the application without mounting their contents. */
  readonly list: Atom.Atom<readonly Tab[]>;

  /**
   * Renders the view for the supplied notebook; it may occupy a whole page.
   */
  readonly render: (props: ViewProps) => React.ReactNode;
}

/** Capabilities available during plugin setup. */
export interface Context {
  /** Registers notebook views in the plugin's scope. */
  readonly view: {
    /**
     * Registers a view until the current Effect scope closes.
     */
    readonly add: (view: View) => Effect.Effect<void, never, Scope.Scope>;
  };
}

/**
 * A plugin identifier and its scoped setup Effect.
 */
export interface Interface<R = never> {
  /** Stable identity across all plugins in one load. */
  readonly id: string;
  /** Acquires registrations and resources released with this plugin. */
  readonly effect: (
    context: Context,
  ) => Effect.Effect<void, unknown, R | Scope.Scope | AtomRegistry.AtomRegistry>;
}

/**
 * Defines a plugin while preserving its inferred type.
 *
 * Setup runs when the host loads the plugin. Register views with `ctx.view.add`;
 * acquire other resources in the same scope so they are released on unload.
 *
 * @example Register a notebook view
 * ```tsx
 * import { Plugin } from "@moku/plugin";
 * import { Atom } from "effect/reactivity";
 *
 * export default Plugin.define({
 *   id: "example",
 *   effect: (ctx) =>
 *     ctx.view.add({
 *       id: "identity",
 *       list: Atom.make([{ id: "main", title: "Notebook identity" }]),
 *       render: ({ notebook }) => <p>{notebook.id}</p>,
 *     }),
 * });
 * ```
 */
export const define = <P extends Interface<unknown>>(plugin: P): P => plugin;

export { load } from "./internal/load.ts";
export type {
  Interface as Loaded,
  State,
  RegisteredView,
  Failure,
} from "./internal/load.ts";
