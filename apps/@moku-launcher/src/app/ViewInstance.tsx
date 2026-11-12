import * as React from "react";
import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import type { Target } from "@moku/core/Notebook";
import type { RegisteredView } from "./Host.ts";
import type { Runtime } from "./runtime.ts";
import { Provider } from "@moku/outputs";

export function ViewInstance({
  target,
  view,
  runtime,
}: {
  target: Target;
  view: RegisteredView;
  runtime: Runtime;
}) {
  const attachment = useAtomValue(runtime.notebook(target));
  if (!AsyncResult.isSuccess(attachment))
    return (
      <div className="empty-state">
        {AsyncResult.isFailure(attachment)
          ? "Could not attach to this notebook."
          : "Connecting to notebook…"}
      </div>
    );
  const Render = view.render;
  return (
    <Provider notebook={attachment.value}>
      <ViewErrorBoundary key={view.key}>
        <Render notebook={attachment.value} />
      </ViewErrorBoundary>
    </Provider>
  );
}

export class ViewErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    return this.state.error ? (
      <div className="error-banner" role="alert">
        This view could not render: {this.state.error.message}
      </div>
    ) : (
      this.props.children
    );
  }
}
