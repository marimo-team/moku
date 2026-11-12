# @momo/plugin

An Effect interface for registering notebook views with a host application.

```tsx
import { Plugin } from "@momo/plugin";

export default Plugin.define({
  id: "dag",
  effect: (ctx) =>
    ctx.view.add({
      id: "graph",
      title: "Graph",
      render: ({ notebook }) => <Dag notebook={notebook} />,
    }),
});

// Public types:
// Plugin.Plugin
// Plugin.Context
// Plugin.View
// Plugin.ViewProps
```
