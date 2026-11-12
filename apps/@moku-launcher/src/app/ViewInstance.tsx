import { Component, type ReactNode } from "react";
import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import type { Target } from "@moku/core/Notebook";
import type { RegisteredView } from "./Host.ts";
import type { Runtime } from "./runtime.ts";

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
  return <Render notebook={attachment.value} />;
}

export class ViewErrorBoundary extends Component<
  { children: ReactNode },
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
