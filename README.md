# momo

A playground for small marimo clients.

```sh
bun install
bun run --filter @momo/outputs build
bun dev
```

The [outputs build](packages/@momo-outputs/README.md) needs a local marimo checkout.
Open the authenticated link printed in the terminal. Start a notebook to inspect:

```sh
uv run marimo edit examples/revenue.py --sandbox --headless
```

Use `bun dev:dag` to select Graph. Register views in
[plugins.ts](apps/@momo-launcher/src/plugins.ts).

```sh
bun run check
bun run format
bun run test
bun run build
```
