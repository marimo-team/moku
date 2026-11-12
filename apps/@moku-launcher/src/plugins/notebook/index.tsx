import { Plugin } from "@moku/plugin";
import { NotebookEditor } from "./NotebookEditor.tsx";
import "./style.css";

export default Plugin.define({
  id: "notebook",
  effect: (ctx) =>
    ctx.view.add({ id: "notebook", title: "Notebook", render: NotebookEditor }),
});
