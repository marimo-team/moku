import { RegistryProvider } from "@effect/atom-react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App.tsx";
import "./style.css";

createRoot(document.getElementById("root")!).render(
  <RegistryProvider>
    <App />
  </RegistryProvider>,
);
