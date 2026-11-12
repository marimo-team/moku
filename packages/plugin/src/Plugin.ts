import type { Effect, Scope } from "effect";
import type { ReactNode } from "react";
import type { Handle } from "@momo/model/Notebook";

export interface ViewProps {
  readonly notebook: Handle;
}

export interface View {
  readonly id: string;
  readonly title: string;
  readonly render: (props: ViewProps) => ReactNode;
}

export interface Context {
  readonly view: {
    readonly add: (view: View) => Effect.Effect<void, never, Scope.Scope>;
  };
}

export interface Plugin {
  readonly id: string;
  readonly effect: (context: Context) => Effect.Effect<void, unknown, Scope.Scope>;
}

export const define = <P extends Plugin>(plugin: P): P => plugin;
