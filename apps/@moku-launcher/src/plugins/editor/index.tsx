import { Plugin } from "@moku/plugin";
import { NotebookScreen } from "./notebook/NotebookScreen.tsx";
import "./style.css";

export default Plugin.define({
  id: "editor",
  effect: (ctx) =>
    ctx.view.add({ id: "notebook", title: "Editor", render: NotebookScreen }),
});
