# Development

```sh
bun setup
bun dev
```

Requires Bun, Git, uv, and the pnpm version declared by the selected marimo checkout.

Setup fetches the GitHub revision in [marimo.json](../marimo.json), prepares the
client and smart-cell parser, installs workspace dependencies, and bundles outputs.
`bun dev` starts a marimo host from that same revision. Open the authenticated link
printed in the terminal.

To use a local checkout for both:

```sh
MARIMO_CHECKOUT=../marimo bun setup
MARIMO_CHECKOUT=../marimo bun dev
```

Rerun setup when switching sources. The override does not change the GitHub pin.
The development server opens `notebooks/` and discovers other running hosts.
Configure its command in [marimo.ts](../scripts/marimo.ts).

Register views in
[plugins.ts](../apps/@moku-launcher/src/plugins.ts).

```sh
bun run check
bun run format
bun run test
bun run build
```
