import { Plugin } from "@momo/plugin";
import { Dag } from "./notebook/NotebookView.tsx";
import "./style.css";

export default Plugin.define({
  id: "dag",
  effect: (ctx) =>
    ctx.view.add({
      id: "graph",
      title: "Graph",
      render: ({ notebook }) => <Dag notebook={notebook} />,
    }),
});
