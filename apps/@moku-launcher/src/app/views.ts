/** Project plugin tab registrations into navigable application views. @module */
import { Atom } from "effect/reactivity";
import type { ViewProps } from "@moku/plugin";
import type * as Host from "./Host.ts";
export interface RegisteredView {
  readonly key: string;
  readonly title: string;
  readonly tab: ViewProps["tab"];
  readonly render: (props: ViewProps) => React.ReactNode;
}
export interface State {
  readonly views: readonly RegisteredView[];
  readonly failures: readonly Host.Failure[];
}
export interface Interface {
  readonly state: Atom.Atom<State>;
}
export function make(plugins: Host.Interface): Interface {
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
