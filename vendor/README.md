# marimo dependencies

`bun setup` prepares the client and smart-cell parser here from the GitHub revision
in the `marimo` field in [package.json](../package.json), then bundles the output renderer from the same
checkout. Generated files are ignored by version control.

Use `MARIMO_CHECKOUT=../marimo bun setup` to develop against a local checkout.
The upstream workspace uses its pinned pnpm version and lockfile; moku uses Bun.
