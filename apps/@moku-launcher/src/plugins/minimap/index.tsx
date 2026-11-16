import { Plugin } from "@moku/plugin";
import { NotebookMinimap } from "./NotebookMinimap.tsx";
import "./style.css";

export default Plugin.define({
  id: "minimap",
  effect: (ctx) =>
    ctx.view.add({
      id: "minimap",
      title: "Minimap",
      render: NotebookMinimap,
    }),
});
