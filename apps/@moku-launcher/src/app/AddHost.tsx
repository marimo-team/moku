import { useAtom } from "@effect/atom-react";
import { Cause } from "effect";
import { AsyncResult, Atom } from "effect/reactivity";
import * as React from "react";
import type * as Workspace from "./Workspace.ts";

export function AddHost({ workspace }: { workspace: Workspace.Interface }) {
  const dialog = React.useRef<HTMLDialogElement>(null);
  const [result, connect] = useAtom(
    React.useMemo(() => Atom.fn(workspace.connectDirect), [workspace]),
  );
  const error = AsyncResult.isFailure(result) && Cause.squash(result.cause);
  React.useEffect(() => {
    if (AsyncResult.isSuccess(result) && !result.waiting) dialog.current?.close();
  }, [result]);
  return (
    <>
      <button
        className="add-host-button"
        type="button"
        aria-haspopup="dialog"
        onClick={() => dialog.current?.showModal()}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
          <path
            d="M8 3v10M3 8h10"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
        Add host
      </button>
      <dialog
        ref={dialog}
        className="add-host-dialog"
        aria-labelledby="add-host-title"
        onClose={(event) => {
          event.currentTarget.querySelector("form")?.reset();
          connect(Atom.Reset);
        }}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            const url = data.get("url");
            const token = data.get("token");
            if (typeof url === "string" && typeof token === "string")
              connect({ url, token });
          }}
        >
          <h2 id="add-host-title">Add host</h2>
          <label>
            Host API URL
            <input
              type="url"
              name="url"
              placeholder="https://host/api/marimo/v1"
              required
            />
          </label>
          <label>
            Host token
            <input type="password" name="token" autoComplete="off" required />
          </label>
          {!result.waiting && error instanceof Error && (
            <p className="error-banner" role="alert">
              {error.message}
            </p>
          )}
          <footer>
            <button type="button" onClick={() => dialog.current?.close()}>
              Cancel
            </button>
            <button type="submit" disabled={result.waiting}>
              {result.waiting ? "Connecting…" : "Connect"}
            </button>
          </footer>
        </form>
      </dialog>
    </>
  );
}
