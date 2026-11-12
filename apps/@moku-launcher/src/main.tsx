import { RegistryProvider } from "@effect/atom-react";
import * as ReactDOMClient from "react-dom/client";
import * as ReactRouter from "react-router";
import * as ReactRouterDOM from "react-router/dom";
import { App } from "./app/App.tsx";
import { makeRuntime } from "./app/runtime.ts";
import { plugins } from "./plugins.ts";
import "./style.css";

const launchKey = new URLSearchParams(location.hash.slice(1)).get("key") ?? undefined;
if (launchKey) history.replaceState(null, "", location.pathname + location.search);
const runtime = makeRuntime({ baseUrl: location.origin, launchKey, plugins });
const router = ReactRouter.createBrowserRouter([
  { path: "*", element: <App runtime={runtime} /> },
]);

ReactDOMClient.createRoot(document.getElementById("root")!).render(
  <RegistryProvider>
    <ReactRouterDOM.RouterProvider router={router} />
  </RegistryProvider>,
);
