import * as Outputs from "@moku/outputs";
import { Plugin } from "@moku/plugin";
import { Dag } from "./notebook/NotebookView.tsx";
import "./style.css";

export default Plugin.define({
  id: "dag",
  effect: (ctx) =>
    ctx.view.add({
      id: "graph",
      title: "Graph",
      render: ({ notebook }) => (
        <Outputs.Provider notebook={notebook}>
          <Dag notebook={notebook} />
        </Outputs.Provider>
      ),
    }),
});
