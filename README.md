# momo

A playground for small marimo clients, with private TypeScript workspace packages.

```sh
bun install
bun dev       # open the launcher
bun dev:dag   # select Graph as the default view
```

Open the authenticated link printed in the terminal. Start a notebook to inspect:

```sh
uv run marimo edit examples/revenue.py --sandbox --headless
```

```sh
bun run check   # formatting, type-aware linting, and typechecking through vp
bun run format # format through vp
bun run test   # all workspace tests through vp
bun run build  # build the launcher and registered views
```

`apps/launcher` owns the catalog, authentication, and open views. It loads plugins
from `apps/launcher/src/plugins.ts`. `apps/dag` exports its graph through
`@momo/dag/plugin`; Vite serves and bundles the launcher.

`@momo/plugin` defines view registrations. Each renderer receives a notebook
handle; open views of the same notebook share an attachment. Inactive tabs stay
mounted so view state survives switching. Closing the last view releases the
attachment. Plugin setup runs in an Effect scope, and failed setup rolls back
its registrations before the remaining plugins load.

`@momo/proxy` supplies the local server. `@momo/model` owns shared workspace and
notebook state. `@momo/editor` and `@momo/outputs` remain package scaffolds.

Workspace exports point directly to TypeScript source. There are no package
compilation steps, project references, or publishing configuration. Vite+ owns
the shared formatting and lint/typecheck settings in `vite.config.ts`;
`tsconfig.json` checks all app and package source without emitting files. The
outputs renderer will retain its explicit bundle step when it is migrated.

DAG's upstream protocol client is preserved as a [pinned local archive](vendor/README.md)
because Bun does not support its former pnpm Git-subdirectory dependency.

See the [glossary](GLOSSARY.md) and package interfaces: [model](packages/model/README.md),
[editor](packages/editor/README.md), [outputs](packages/outputs/README.md),
[proxy](packages/proxy/README.md), [plugin](packages/plugin/README.md).
