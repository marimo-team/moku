/** Project plugin tab registrations into navigable application views. @module */
import { Atom } from "effect/reactivity";
import type { Plugin, ViewProps } from "@moku/plugin";
export interface RegisteredView {
  readonly key: string;
  readonly title: string;
  readonly tab: ViewProps["tab"];
  readonly render: (props: ViewProps) => React.ReactNode;
}
export interface State {
  readonly views: readonly RegisteredView[];
  readonly failures: readonly Plugin.Failure[];
}
export interface Interface {
  readonly state: Atom.Atom<State>;
}
export function make(plugins: Plugin.Loaded): Interface {
  return {
    state: Atom.readable((get): State => {
      const { views, failures } = get(plugins.state);
      return {
        failures,
        views: views.flatMap((view) =>
          get(view.list).map((tab) => ({
            key: `${view.key}/${encodeURIComponent(tab.id)}`,
            title: tab.title,
            tab,
            render: view.render,
          })),
        ),
      };
    }),
  };
}
