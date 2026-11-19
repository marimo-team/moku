import { Plugin } from "@moku/plugin";
import { Dialog } from "./Dialog.tsx";
import "../notebook/style.css";
import "./style.css";

export default Plugin.define({
  id: "dialog",
  effect: (ctx) =>
    ctx.view.add({
      id: "dialog",
      title: "Dialog",
      render: Dialog,
    }),
});
