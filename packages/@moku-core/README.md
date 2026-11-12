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

## Live runtime stress test

After `bun setup`, run:

```sh
bun packages/@moku-core/tests/stress-runtime.ts 3
```

This starts an isolated marimo host and moku proxy using the configured checkout.
Eight temporary copies of the example notebooks start concurrently, execute all
cells, and connect native outputs through the real core model. Subsequent rounds
stop and restart each kernel. Unique notebook paths create fresh script environments;
package downloads still use the existing uv cache. The test keeps timings, server
logs, and any failure state in the printed temporary directory, and closes its host
and kernels on exit. It does not run as part of the unit test suite.
