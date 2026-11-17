/**
 * Connect output renderers to a notebook's runtime capabilities.
 *
 * @module
 */
import * as React from "react";
import { useAtom, useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/reactivity";
import * as RendererConnection from "./internal/RendererConnection.ts";
import type * as RendererSession from "./internal/RendererSession.ts";
import type * as Comm from "@moku/core/experimental/Comm";

/** The subset of a notebook needed by output renderers. */
export interface Notebook {
  /** The channel shared by renderers of this notebook. */
  readonly runtime: { readonly experimentalComm: Comm.Interface };
  /** Resolves kernel-authored file references used in rendered output. */
  readonly assetUrl: (path: string) => string;
}
export interface ProviderProps {
  readonly notebook: Notebook;
  readonly children: React.ReactNode;
}

export const OutputContext = React.createContext<{
  session: RendererSession.Interface | null;
  canInteract: boolean;
}>({ session: null, canInteract: false });

/**
 * Supplies native widgets, function calls, and assets to descendant outputs.
 *
 * Outputs must include their producing `runtimeId` to enable interaction.
 * Providers for the same notebook share a connection. The embedded renderer
 * currently supports one interactive notebook per page; unmounting its last
 * provider releases the connection and clears its widget registries.
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
  const connection = useAtomValue(comm.state, (state) => state.connection);
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
  const canInteract = connection._tag === "Connected" && connection.canInteract;
  return (
    <OutputContext.Provider value={{ session: state.session, canInteract }}>
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
