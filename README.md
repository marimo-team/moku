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

```sh
bun setup
bun dev
```

with a local marimo checkout:

```sh
MARIMO_CHECKOUT=../marimo bun setup
MARIMO_CHECKOUT=../marimo bun dev
```

```sh
bun run test
bun run check
bun run format
```
