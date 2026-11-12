# Development

## Setup

```sh
bun setup
bun dev
```

Requires Bun, Git, uv, and the pnpm version declared by the selected marimo checkout.

Setup fetches the GitHub revision in the `marimo` field in [package.json](package.json), prepares the
client and smart-cell parser, builds marimo’s native frontend, installs workspace
dependencies, and bundles outputs. `bun dev` starts marimo from that checkout as
an editable install, so notebook sandboxes preserve the selected revision. Open
the authenticated link printed in the terminal.

## Local marimo checkout

To use a local checkout for both:

```sh
MARIMO_CHECKOUT=../marimo bun setup
MARIMO_CHECKOUT=../marimo bun dev
```

Rerun setup when switching sources. The override does not change the GitHub pin.
The development server opens `notebooks/` and discovers other running hosts.
Configure its command in [marimo.ts](scripts/marimo.ts).

## Adding views

Register views in
[plugins.ts](apps/@moku-launcher/src/plugins.ts).

## Imports

Prefer namespace imports for library functions: `React.useState`,
`ReactRouter.useNavigate`, `Vitest.test`, and `NodeFs.readFile`.
Use separate namespaces for CodeMirror's state, view, and commands modules.
Keep Effect's module imports (`Effect`, `Stream`, `Atom`, etc.): they already
provide namespaces. Keep named imports from `@effect/atom-react` and Vitest's
`vi` namespace. Direct component and type imports are fine.

## Checks

```sh
bun run check
bun run format
bun run test
bun run build
```
