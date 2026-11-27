# @moku/plugin

Define notebook views with scoped setup and cleanup.

```tsx
import { Plugin } from "@moku/plugin";
import * as React from "react";

const Inspector = React.lazy(() => import("./Inspector"));

export default Plugin.define({
  id: "inspector",
  effect: (ctx) =>
    ctx.view.add({
      id: "overview",
      title: "Overview",
      render: ({ notebook }) => <Inspector notebook={notebook} />,
    }),
});
```

Load plugins in an Effect scope with an atom registry.

```ts
import { Plugin } from "@moku/plugin";
import { Layer } from "effect";
import { Atom } from "effect/reactivity";

import inspector from "./inspector";

const runtime = Atom.runtime(Layer.empty);
const plugins = runtime.atom(Plugin.load([inspector]));
```

The loaded state lists views by their plugin and view IDs. Each view has a title
and a render function that receives the selected notebook. A plugin can register
several views. Closing its scope releases its registrations and resources.
Failed setup is cleaned up without preventing other plugins from loading.

Render a view in the notebook's atom registry, with React Suspense and an error
boundary. Interactive outputs also need the `@moku/outputs` provider.
