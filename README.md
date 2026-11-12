<h1 align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/moku-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="assets/moku-light.svg">
    <img src="assets/moku-light.svg" width="360" height="200" alt="moku">
  </picture>
</h1>

<p align="center">
  <sub>/ˈmo.ku/</sub>
  <br>
  building blocks for a <a href="https://wehe.hilo.hawaii.edu/?q=moku">“forest”</a> of marimo clients.
</p>

```sh
bun setup
bun dev
```

With a local marimo checkout:

```sh
MARIMO_CHECKOUT=../marimo bun setup
MARIMO_CHECKOUT=../marimo bun dev
```

```sh
bun run test
bun run check
bun run format
```
