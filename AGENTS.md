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

## Making a package

The goal is to build dependable modules that others can build upon, with thoughtful
interfaces and documentation that makes them easy to understand. Design deep
modules that handle substantial behavior through a small, clear interface. Look
at the existing [packages](packages) before choosing the structure and exports.
Prefer idiomatic named exports that read naturally through namespace imports,
and keep implementation helpers private.

Start the README with one clear sentence explaining what the package does for
someone using it, followed by a small code example that demonstrates its public
interface. Treat the example as a starting point someone can adapt in a scratch
file, with the imports and setup needed to understand it. Follow it with only the
context needed to use the module correctly. The
[plugin README](packages/@moku-plugin/README.md) and
[editor README](packages/@moku-editor/README.md) show this structure.

Write connected prose in complete sentences that explain purpose and behavior.
Avoid choppy fragments, repetitive phrasing, em dashes, and colon-led lists in
explanatory prose. Keep implementation details and reference documentation in
the source rather than cataloging exports or CSS selectors in the README.

Follow the [Deno and JSR documentation conventions](https://jsr.io/docs/writing-docs).
Begin every public module with a JSDoc comment containing a clear description and
an `@module` tag. Document exported symbols and their public properties and methods
where they are defined. Start each comment with a single-line sentence describing
what the symbol means or does, then add further explanation in a separate
paragraph when needed. Explain defaults, missing values, and other behavior that
callers need to understand without repeating the TypeScript types. Use `@example`
for useful examples and `{@link ...}` for related symbols.

For example, a property can have a short summary followed by the behavior that
matters to its caller.

```ts
/** Dependency information for the current notebook document. */
export interface Graph {
  /**
   * Whether dependency analysis matches the current document.
   *
   * When false, cells remain visible but their dependency information is unavailable.
   */
  readonly current: boolean;
}
```

[Notebook.ts](packages/@moku-core/src/Notebook.ts) provides examples of module
documentation, public interfaces, and usage examples alongside exported functions.

## Making a plugin

Add plugins under [the launcher plugins directory](apps/@moku-launcher/src/plugins)
and register them in [main.tsx](apps/@moku-launcher/src/main.tsx). Look at the existing
plugins for how to register views and separate state, React views, and supporting
modules as the feature grows. Use [@moku/plugin](packages/@moku-plugin/README.md)
to define the plugin and its registrations. Add a local README when the plugin
needs usage or design context that is not clear from the code.

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
bun run test:coverage
bun run build
```

CI runs checks and tests with coverage in separate steps. `bun setup --checks`
prepares only the dependencies needed for these steps; use regular `bun setup`
before running the development server.
