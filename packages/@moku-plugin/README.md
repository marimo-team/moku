# @moku/plugin

Define notebook views with scoped setup and cleanup.

```tsx
import * as React from "react";
import { Atom } from "effect/reactivity";
import { Plugin } from "@moku/plugin";

const Inspector = React.lazy(() => import("./Inspector"));
const tabs = Atom.make([{ id: "overview", title: "Overview" }]);

export default Plugin.define({
  id: "inspector",
  effect: (ctx) =>
    ctx.view.add({
      id: "inspect",
      list: tabs,
      render: ({ notebook, tab }) => <Inspector notebook={notebook} tab={tab} />,
    }),
});
```
