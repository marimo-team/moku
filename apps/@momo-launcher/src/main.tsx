import { RegistryProvider } from "@effect/atom-react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App.tsx";
import { makeRuntime } from "./app/runtime.ts";
import { plugins } from "./plugins.ts";
import "./style.css";

const launchKey = new URLSearchParams(location.hash.slice(1)).get("key") ?? undefined;
if (launchKey) history.replaceState(null, "", location.pathname + location.search);
const runtime = makeRuntime({ baseUrl: location.origin, launchKey, plugins });

createRoot(document.getElementById("root")!).render(
  <RegistryProvider>
    <App runtime={runtime} />
  </RegistryProvider>,
);
