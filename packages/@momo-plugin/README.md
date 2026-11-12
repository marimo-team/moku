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
```

Each renderer receives a `Notebook.Interface`. The launcher selects the notebook
and shares its attachment across open views. Plugin setup runs in an Effect scope;
registrations and acquired resources are released when that scope closes.
