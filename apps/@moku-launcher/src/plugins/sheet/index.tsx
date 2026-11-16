import { Plugin } from "@moku/plugin";
import { Sheet } from "./Sheet.tsx";
import "./style.css";

export default Plugin.define({
  id: "sheet",
  effect: (ctx) => ctx.view.add({ id: "sheet", title: "Sheet", render: Sheet }),
});
