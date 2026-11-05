import { useEffect, useState } from "react";
import { Workspace } from "./Workspace.tsx";

async function authenticate() {
  const key = new URLSearchParams(location.hash.slice(1)).get("key");
  if (key) history.replaceState(null, "", location.pathname + location.search);
  const response = await fetch(
    "/api/session",
    key ? { method: "POST", headers: { Authorization: `Bearer ${key}` } } : undefined,
  );
  if (!response.ok) throw new Error("Open the authenticated launch link printed by pnpm dev.");
}

export function App() {
  const [auth, setAuth] = useState<"loading" | "ready" | "locked">("loading");
  useEffect(() => {
    void authenticate().then(
      () => setAuth("ready"),
      () => setAuth("locked"),
    );
  }, []);
  if (auth !== "ready")
    return (
      <div className="auth-screen">
        <h1>dag</h1>
        <p>
          {auth === "loading"
            ? "Connecting…"
            : "Open the authenticated launch link printed in your terminal."}
        </p>
        {auth === "locked" && <code>pnpm dev</code>}
      </div>
    );
  return <Workspace />;
}
