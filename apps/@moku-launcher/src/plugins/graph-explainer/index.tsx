import { Atom } from "effect/reactivity";
import { Plugin } from "@moku/plugin";
import { GraphExplainer } from "./GraphExplainer.tsx";
import "./style.css";

export default Plugin.define({
  id: "graph-explainer",
  effect: (ctx) =>
    ctx.view.add({
      id: "graph",
      list: Atom.make([{ id: "main", title: "Graph explainer" }]),
      render: GraphExplainer,
    }),
});
