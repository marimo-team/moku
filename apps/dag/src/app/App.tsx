import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import { Workspace } from "./Workspace.tsx";
import { workspaceAtom } from "./runtime.ts";

export function App() {
  const workspace = useAtomValue(workspaceAtom);
  if (!AsyncResult.isSuccess(workspace)) {
    const failed = AsyncResult.isFailure(workspace);
    return (
      <div className="auth-screen">
        <h1>dag</h1>
        <p>
          {failed
            ? "Open the authenticated launch link printed in your terminal."
            : "Connecting…"}
        </p>
        {failed && <code>bun dev:dag</code>}
      </div>
    );
  }
  return <Workspace workspace={workspace.value} />;
}
