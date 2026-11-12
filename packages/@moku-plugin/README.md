# @moku/plugin

Notebook views that a host can register, open, and unload together.

```tsx
import { Plugin, type ViewProps } from "@moku/plugin";

function Identity({ notebook }: ViewProps) {
  return <p>{notebook.target.notebookId}</p>;
}

export default Plugin.define({
  id: "example",
  effect: (ctx) =>
    ctx.view.add({
      id: "identity",
      title: "Notebook identity",
      render: (props) => <Identity {...props} />,
    }),
});
```

The host supplies the selected notebook through `ViewProps`.
Registrations and other scoped resources are released when the plugin unloads.
