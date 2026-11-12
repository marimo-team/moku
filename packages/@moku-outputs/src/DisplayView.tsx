/**
 * Render individual display values with a lazy rich-output renderer.
 *
 * @module
 */
import * as React from "react";
import type { DisplayData, DisplayViewProps } from "./types.ts";
import { loadRenderer, loadStyles } from "./internal/renderer.ts";
import { ShadowOutput } from "./internal/ShadowOutput.tsx";
import { OutputContext } from "./Provider.tsx";
import "./style.css";

function RichDisplay(props: DisplayViewProps): React.ReactElement {
  const { DisplayRenderer } = React.use(loadRenderer());
  const css = React.use(loadStyles());
  const context = React.useContext(OutputContext);
  return (
    <ShadowOutput css={css}>
      <DisplayRenderer {...props} {...context} />
    </ShadowOutput>
  );
}

/**
 * Renders one display value according to its MIME type.
 *
 * Rich outputs have their own shadow root to isolate their markup and styling.
 * Plain text renders immediately. Rich displays load the marimo renderer and
 * stylesheet on demand, render nothing while loading, and show an error message
 * if rendering fails.
 */
export function DisplayView({
  data,
  className,
  runtimeId,
}: DisplayViewProps): React.ReactElement {
  return (
    <div className={["moku-display", className].filter(Boolean).join(" ")}>
      {data.mimetype === "text/plain" ? (
        <pre className="moku-output-text">{data.data}</pre>
      ) : (
        <DisplayErrorBoundary data={data}>
          <React.Suspense fallback={null}>
            <RichDisplay data={data} runtimeId={runtimeId} />
          </React.Suspense>
        </DisplayErrorBoundary>
      )}
    </div>
  );
}

interface BoundaryState {
  readonly data: DisplayData | null;
  readonly failed: boolean;
}

class DisplayErrorBoundary extends React.Component<
  { readonly data: DisplayData; readonly children: React.ReactNode },
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

  render(): React.ReactNode {
    if (this.state.failed) {
      return (
        <p className="moku-output-notice" role="alert">
          Could not render this output.
        </p>
      );
    }
    return this.props.children;
  }
}
