/**
 * Scoped registrations for notebook views.
 *
 * The host selects a notebook and supplies it to each view. Views of the same
 * notebook can share its observation and commands.
 *
 * @module
 */
import type { Effect, Scope } from "effect";
import type * as React from "react";
import type * as Notebook from "@moku/core/Notebook";

/**
 * The notebook selected by the host for this view instance.
 */
export interface ViewProps {
  readonly notebook: Notebook.Interface;
}

/**
 * A named notebook view that the host can open.
 */
export interface View {
  readonly id: string;
  readonly title: string;

  /**
   * Renders the view for the supplied notebook; it may occupy a whole page.
   */
  readonly render: (props: ViewProps) => React.ReactNode;
}

export interface Context {
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
export interface Plugin {
  readonly id: string;
  readonly effect: (context: Context) => Effect.Effect<void, unknown, Scope.Scope>;
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
export const define = <P extends Plugin>(plugin: P): P => plugin;
