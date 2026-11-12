/**
 * Render individual display values with a lazy rich-output renderer.
 *
 * @module
 */
import {
  Component,
  Suspense,
  use,
  useContext,
  type ReactElement,
  type ReactNode,
} from "react";
import type { DisplayData, DisplayViewProps } from "./types.ts";
import { loadRenderer } from "./internal/renderer.ts";
import { OutputContext } from "./Provider.tsx";
import "./style.css";

function RichDisplay(props: DisplayViewProps): ReactElement {
  const { DisplayRenderer } = use(loadRenderer());
  const context = useContext(OutputContext);
  return <DisplayRenderer {...props} {...context} />;
}

/**
 * Renders one display value according to its MIME type.
 *
 * Plain text renders immediately. Rich displays load the marimo renderer and
 * stylesheet on demand, render nothing while loading, and show an error message
 * if rendering fails.
 */
export function DisplayView({
  data,
  className,
  runtimeId,
}: DisplayViewProps): ReactElement {
  return (
    <div className={["momo-display", className].filter(Boolean).join(" ")}>
      {data.mimetype === "text/plain" ? (
        <pre className="momo-output-text">{data.data}</pre>
      ) : (
        <DisplayBoundary data={data}>
          <Suspense fallback={null}>
            <RichDisplay data={data} runtimeId={runtimeId} />
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
