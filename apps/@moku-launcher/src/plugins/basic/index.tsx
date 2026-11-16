import { Atom } from "effect/reactivity";
import { Plugin } from "@moku/plugin";
import { Basic } from "./Basic.tsx";

export default Plugin.define({
  id: "basic",
  effect: (ctx) =>
    ctx.view.add({
      id: "cell",
      list: Atom.make([{ id: "main", title: "Basic" }]),
      render: Basic,
    }),
});
