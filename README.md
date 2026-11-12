# Momo

A playground for small marimo clients, with private TypeScript workspace packages.

```sh
bun install
bun dev:dag
```

Open the authenticated link printed in the terminal. Start a notebook to inspect:

```sh
uv run marimo edit examples/revenue.py --sandbox --headless
```

```sh
bun run check   # formatting, type-aware linting, and typechecking through vp
bun run format # format through vp
bun run test   # all workspace tests through vp
bun run build  # build the DAG app
```

`apps/dag` is the working app. `@momo/proxy` supplies its local server and Vite
plugin. `@momo/client`, `@momo/editor`, and `@momo/outputs` are private package
scaffolds; their READMEs describe the planned interfaces.

Workspace exports point directly to TypeScript source. There are no package
compilation steps, project references, or publishing configuration. Vite+ owns
the shared formatting and lint/typecheck settings in `vite.config.ts`;
`tsconfig.json` checks all app and package source without emitting files. The
outputs renderer will retain its explicit bundle step when it is migrated.

DAG's upstream protocol client is preserved as a [pinned local archive](vendor/README.md)
because Bun does not support its former pnpm Git-subdirectory dependency.

See the [glossary](GLOSSARY.md) and package interfaces: [client](packages/client/README.md),
[editor](packages/editor/README.md), [outputs](packages/outputs/README.md),
[proxy](packages/proxy/README.md).
