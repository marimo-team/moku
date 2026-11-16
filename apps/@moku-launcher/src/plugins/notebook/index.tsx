import { Atom } from "effect/reactivity";
import { Plugin } from "@moku/plugin";
import { NotebookEditor } from "./NotebookEditor.tsx";
import "./style.css";

export default Plugin.define({
  id: "notebook",
  effect: (ctx) =>
    ctx.view.add({
      id: "notebook",
      list: Atom.make([{ id: "main", title: "Notebook" }]),
      render: NotebookEditor,
    }),
});
