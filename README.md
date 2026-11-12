# momo

A playground for small marimo clients.

```sh
bun install
bun run --filter @momo/outputs build
bun dev
```

The [outputs build](packages/@momo-outputs/README.md) needs a local marimo checkout.
Open the authenticated link printed in the terminal. The launcher starts marimo for
`examples/` using `../marimo` and discovers other running hosts. Configure the
command in [vite.config.ts](apps/@momo-launcher/vite.config.ts).

Use `bun dev:dag` to list Graph first in “Open with”. Register views in
[plugins.ts](apps/@momo-launcher/src/plugins.ts).

```sh
bun run check
bun run format
bun run test
bun run build
```
