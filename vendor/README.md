# marimo dependencies

`bun setup` prepares the client, host protocol, and smart-cell parser here from the GitHub revision
in the `marimo` field in [package.json](../package.json), then bundles the output renderer from the same
checkout. Generated files are ignored by version control.

Use `MARIMO_CHECKOUT=../marimo bun setup` to develop against a local checkout.
The upstream workspace uses its pinned pnpm version and lockfile; moku uses Bun.

## Sketcher

[sketcher](sketcher) is different. It holds the whiteboard from
[koaning/sketcher](https://github.com/koaning/sketcher) that the launcher's Drawing view is built
on, and it is checked in. Run `bun run sketcher <sketcher checkout>` to vendor a newer
revision, and change the board upstream rather than here.
