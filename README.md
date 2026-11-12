<h1 align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/moku-icon-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="assets/moku-icon-light.svg">
    <img src="assets/moku-icon-light.svg" width="128" height="128" alt="">
  </picture>
  <br>
  moku
</h1>

<p align="center">a little forest of marimo clients</p>

## The playground

moku is a playground for experimenting with different marimo clients. Currently growing:

- **Notebook** — a notebook editor with interactive outputs.
- **Graph explainer** — a view of cell dependencies and execution.

The clients share connections, notebook state, editing, and output rendering through the [packages](packages/).

## Run it

Requires Bun, Git, uv, and the pnpm version used by the selected marimo checkout. See [development setup](docs/development.md) for details.

```sh
bun setup
bun dev
```

Open the authenticated link printed in the terminal.

## Tinker

Add a view with [@moku/plugin](packages/@moku-plugin/README.md) and register it in [plugins.ts](apps/@moku-launcher/src/plugins.ts).

The [development guide](docs/development.md) covers local marimo checkouts, tests, and builds.
