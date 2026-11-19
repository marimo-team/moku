/**
 * Connect output renderers to a notebook's runtime capabilities.
 *
 * @module
 */
import type * as Model from "@moku/core/Notebook";
import * as React from "react";
import { useAtom, useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/reactivity";
import * as RendererConnection from "./internal/RendererConnection.ts";
import type * as RendererSession from "./internal/RendererSession.ts";

/** The notebook that owns the displayed outputs. */
export interface Notebook {
  /** The runtime that receives widget updates and function calls. */
  readonly runtime: Pick<Model.Runtime, "experimentalComm">;
  /** Resolves kernel-authored file references used in rendered output. */
  readonly assetUrl: (path: string) => string;
}
/** Inputs for rendering interactive outputs from one notebook. */
export interface ProviderProps {
  /** The notebook that produced these outputs. */
  readonly notebook: Notebook;
  /** Output views that can use the notebook’s widgets. */
  readonly children: React.ReactNode;
}

export const OutputContext = React.createContext<RendererSession.Interface | null>(
  null,
);

/**
 * Connects descendant widgets to the runtime that produced their outputs.
 *
 * Pass the producing `runtimeId` with each output. After a kernel restart,
 * older outputs stay disconnected. Providers on a page can share one notebook.
 * Unmounting the last provider releases its widgets.
 *
 * @example Render a selected execution
 * ```tsx
 * <Outputs.Provider notebook={notebook}>
 *   <Outputs.CellOutputs {...outputs} />
 * </Outputs.Provider>
 * ```
 */
export function Provider({ notebook, children }: ProviderProps) {
  const comm = notebook.runtime.experimentalComm;
  const { assetUrl } = notebook;
  const connection = useAtomValue(comm.connection);
  const [reconnecting, reconnect] = useAtom(
    React.useMemo(() => Atom.fn(() => comm.retry).pipe(Atom.setIdleTTL(0)), [comm]),
  );
  const [state, setState] = React.useState<RendererConnection.State>({
    session: null,
    error: null,
  });
  React.useEffect(() => {
    try {
      return RendererConnection.acquire(comm, assetUrl, setState);
    } catch (cause) {
      setState({
        session: null,
        error: cause instanceof Error ? cause : new Error(String(cause)),
      });
    }
  }, [comm, assetUrl]);
  const error = state.error ?? (connection._tag === "Failed" ? connection.error : null);
  return (
    <OutputContext.Provider value={state.session}>
      {error && (
        <div className="moku-output-notice" role="alert">
          {error.message}
          {!state.error && (
            <button
              type="button"
              disabled={reconnecting.waiting}
              onClick={() => reconnect()}
            >
              Reconnect outputs
            </button>
          )}
        </div>
      )}
      {state.error ? null : children}
    </OutputContext.Provider>
  );
}
