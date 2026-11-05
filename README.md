# dag-client

An interactive client for a marimo notebook's dependency graph, execution
timeline, and cell outputs.

Built with Vite+, React, and `@marimo-team/client`.

## getting started

```sh
pnpm install
pnpm dev
```

Open the authenticated link printed in the terminal. Start a notebook, then select it in the viewer:

```sh
uv run marimo edit examples/revenue.py --sandbox --headless
```

## development

```sh
pnpm check
pnpm test
pnpm build
pnpm format
```
