/** Mount the standalone protocol walkthrough. @module */
import * as React from "react";
import * as ReactDOM from "react-dom/client";
import { App } from "./App.tsx";
import "./style.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing application root");
ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
