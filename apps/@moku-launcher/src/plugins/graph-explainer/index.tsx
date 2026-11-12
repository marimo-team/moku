import { Plugin } from "@moku/plugin";
import { GraphExplainer } from "./GraphExplainer.tsx";
import "./style.css";

export default Plugin.define({
  id: "graph-explainer",
  effect: (ctx) =>
    ctx.view.add({ id: "graph", title: "Graph explainer", render: GraphExplainer }),
});
