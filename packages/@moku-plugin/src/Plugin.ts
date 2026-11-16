/**
 * Define notebook views for an application.
 *
 * The application selects a notebook and renders each view in its atom registry.
 * Plugin resources live in the scope passed to {@link load}.
 *
 * @module
 */
import type { AtomRegistry } from "effect/reactivity";
import type { Effect, Scope } from "effect";
import type * as React from "react";
import type * as Notebook from "@moku/core/Notebook";

/**
 * Inputs supplied when the application renders a view.
 */
export interface ViewProps {
  /** The notebook selected for this view instance. */
  readonly notebook: Notebook.Interface;
}

/** A notebook view that the application can select and render. */
export interface View {
  /** Stable identity within the plugin. */
  readonly id: string;
  /** Label displayed in the application's view picker. */
  readonly title: string;
  /** Renders the selected notebook in the application's atom registry. */
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
 * A plugin whose setup acquires views and other scoped resources.
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
 * Defines a plugin while preserving the services its setup requires.
 *
 * {@link load} runs setup in a child scope. Register views with `ctx.view.add`
 * and acquire other resources in that scope so they are released together.
 *
 * @example Register a notebook view
 * ```tsx
 * import { Plugin } from "@moku/plugin";
 *
 * export default Plugin.define({
 *   id: "example",
 *   effect: (ctx) =>
 *     ctx.view.add({
 *       id: "identity",
 *       title: "Notebook identity",
 *       render: ({ notebook }) => <p>{notebook.target.notebookId}</p>,
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
