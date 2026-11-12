import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import type * as Workspace from "@momo/model/Workspace";
import { Launcher } from "./Launcher.tsx";
import type { Runtime } from "./runtime.ts";

export function App({ runtime }: { runtime: Runtime }) {
  const workspace = useAtomValue(runtime.workspace);
  if (!AsyncResult.isSuccess(workspace)) {
    const failed = AsyncResult.isFailure(workspace);
    return (
      <div className="auth-screen">
        <h1>momo</h1>
        <p>
          {failed
            ? "Open the authenticated launch link printed in your terminal."
            : "Connecting…"}
        </p>
        {failed && <code>bun dev</code>}
      </div>
    );
  }
  return <Loaded runtime={runtime} workspace={workspace.value} />;
}

function Loaded({
  runtime,
  workspace,
}: {
  runtime: Runtime;
  workspace: Workspace.Workspace;
}) {
  const host = useAtomValue(runtime.host);
  if (!AsyncResult.isSuccess(host))
    return (
      <div className="empty-state">
        {AsyncResult.isFailure(host) ? "Could not load views." : "Loading views…"}
      </div>
    );
  return <Launcher runtime={runtime} workspace={workspace} host={host.value} />;
}
