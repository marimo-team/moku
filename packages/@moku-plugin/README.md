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

## Load plugins

```ts
import { Layer } from "effect";
import { Atom } from "effect/reactivity";
import { Plugin } from "@moku/plugin";
import inspector from "./inspector";

const runtime = Atom.runtime(Layer.empty);
const plugins = runtime.atom(Plugin.load([inspector]));
```

Closing the scope releases registrations and plugin resources. Failed setup is
cleaned up without preventing other plugins from loading.

## Render a selected tab

```tsx
import * as React from "react";
import { useAtomValue } from "@effect/atom-react";

const tabs = useAtomValue(view.list);
const tab = tabs.find((tab) => tab.id === selectedTabId);

return (
  <React.Suspense fallback={<Spinner />}>
    {tab && view.render({ notebook, tab })}
  </React.Suspense>
);
```

Use the notebook's atom registry and provide an error boundary for view failures.
Interactive outputs also need the `@moku/outputs` provider.
