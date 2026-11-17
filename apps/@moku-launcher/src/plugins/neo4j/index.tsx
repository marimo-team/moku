import { Plugin } from "@moku/plugin";
import { Neo4jNotebook } from "./Neo4jNotebook.tsx";
import "../notebook/style.css";
import "./style.css";

export default Plugin.define({
  id: "neo4j",
  effect: (ctx) =>
    ctx.view.add({
      id: "notebook",
      title: "Neo4j",
      render: Neo4jNotebook,
    }),
});
