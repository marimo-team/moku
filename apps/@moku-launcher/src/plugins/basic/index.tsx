import { Plugin } from "@moku/plugin";
import { Basic } from "./Basic.tsx";

export default Plugin.define({
  id: "basic",
  effect: (ctx) => ctx.view.add({ id: "cell", title: "Basic", render: Basic }),
});
