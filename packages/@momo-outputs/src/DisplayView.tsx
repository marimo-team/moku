import { Component, Suspense, use, type ReactElement, type ReactNode } from "react";
import type { DisplayData, DisplayViewProps } from "./types.ts";
import { loadRenderer } from "./internal/renderer.ts";
import "./style.css";

function RichDisplay(props: DisplayViewProps): ReactElement {
  const { DisplayRenderer } = use(loadRenderer());
  return <DisplayRenderer {...props} />;
}

export function DisplayView({ data, className }: DisplayViewProps): ReactElement {
  return (
    <div className={["momo-display", className].filter(Boolean).join(" ")}>
      {data.mimetype === "text/plain" ? (
        <pre className="momo-output-text">{data.data}</pre>
      ) : (
        <DisplayBoundary data={data}>
          <Suspense fallback={null}>
            <RichDisplay data={data} />
          </Suspense>
        </DisplayBoundary>
      )}
    </div>
  );
}

interface BoundaryState {
  readonly data: DisplayData | null;
  readonly failed: boolean;
}

class DisplayBoundary extends Component<
  { readonly data: DisplayData; readonly children: ReactNode },
  BoundaryState
> {
  state: BoundaryState = { data: null, failed: false };

  static getDerivedStateFromError(): Partial<BoundaryState> {
    return { failed: true };
  }

  static getDerivedStateFromProps(
    { data }: { readonly data: DisplayData },
    state: BoundaryState,
  ): Partial<BoundaryState> | null {
    return data === state.data ? null : { data, failed: false };
  }

  render(): ReactNode {
    if (this.state.failed) {
      return (
        <p className="momo-output-notice" role="alert">
          Could not render this output.
        </p>
      );
    }
    return this.props.children;
  }
}
