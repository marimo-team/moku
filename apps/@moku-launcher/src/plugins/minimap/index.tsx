import { Atom } from "effect/reactivity";
import { Plugin } from "@moku/plugin";
import { NotebookMinimap } from "./NotebookMinimap.tsx";
import "./style.css";

export default Plugin.define({
  id: "minimap",
  effect: (ctx) =>
    ctx.view.add({
      id: "minimap",
      list: Atom.make([{ id: "main", title: "Minimap" }]),
      render: NotebookMinimap,
    }),
});
