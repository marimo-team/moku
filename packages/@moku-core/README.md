# @moku/core

Shared connections, live notebook state, and commands for marimo clients.

```ts
import { Atom } from "effect/reactivity";
import * as Model from "@moku/core";
import * as Workspace from "@moku/core/Workspace";
import * as Notebook from "@moku/core/Notebook";

const runtime = Atom.runtime(Model.layer(window.location.origin));
const workspace = runtime.atom(Workspace.make());
const openNotebook = (target: Notebook.Target) => runtime.atom(Notebook.make(target));
```

`Workspace.Workspace` exposes host connections and notebook catalogs.
`Notebook.Interface` exposes a notebook's state, edits, saves, and runtime commands.
Mount and read these atoms in the same registry; releasing them closes their scopes.
Pass `{ launchKey }` to `Workspace.make` on first launch to establish a session.
