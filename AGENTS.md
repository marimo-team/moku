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

## Effect

Before writing Effect code, read the [installed Effect
guide](apps/@moku-launcher/node_modules/effect/AGENTS.md) completely. Follow its
relevant links and consult the package's [source](apps/@moku-launcher/node_modules/effect/src)
for APIs. Use the installed version's guidance rather than examples from other versions.

## Generated code

Follow generated-file headers back to their sources, change the source, and
regenerate the output. See [setup.ts](scripts/setup.ts) for how vendored marimo
code and bundles are prepared.

## Making a package

Before creating a package, consider where the behavior belongs, what responsibility
the package would own, and what complexity it would hide from callers. We want
deep modules that do substantial work through small, coherent interfaces. Callers
should be able to use a module without learning its internal structure or
coordinating its implementation details. If the proposed interface exposes most
of that complexity, rethink the design before extracting it.

Look at the existing [packages](packages) to decide whether the behavior fits an
existing module or should remain local to a plugin. A new package should earn its
place by giving callers a clear capability with fewer concepts to manage.
Packages are foundations for other code, so hold them to a high bar for interface
design, implementation quality, and documentation. Prefer idiomatic named exports
that read naturally through namespace imports, and keep implementation helpers
private.

Start the README with one clear sentence explaining what the package does,
followed by a small usage example with the imports and setup someone needs to
try it. Add only the context needed to use the module correctly. The
[plugin README](packages/@moku-plugin/README.md) and
[editor README](packages/@moku-editor/README.md) show this structure.

Write connected prose in complete sentences that explain purpose and behavior.
Avoid choppy fragments, repetitive phrasing, em dashes, and colon-led lists in
explanatory prose. Keep implementation details and reference documentation in
the source rather than cataloging exports or CSS selectors in the README.
Read nearby docstrings before editing, and document non-obvious behavior rather
than the design conversation or what the code already says.

Follow the [Deno and JSR documentation conventions](https://jsr.io/docs/writing-docs).
Begin every public module with a JSDoc description and an `@module` tag. Document
exported symbols and their public properties and methods where they are defined.
Start each comment with a single-line sentence describing what the symbol means
or does, then explain further in a separate paragraph when needed. Document
defaults, missing values, and other behavior callers need to understand without
repeating the TypeScript types. Use `@example` for examples and `{@link ...}` for
related symbols.

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

See [Notebook.ts](packages/@moku-core/src/Notebook.ts) for examples of module and
function documentation.

## Making a plugin

Define plugins with [@moku/plugin](packages/@moku-plugin/README.md), add them under
[the launcher plugins directory](apps/@moku-launcher/src/plugins), and register them
in [main.tsx](apps/@moku-launcher/src/main.tsx). Follow existing plugins when
separating state, React views, and supporting modules. Add a local README when
usage or design context is not clear from the code.

## Imports

Prefer namespace imports for library functions: `React.useState`,
`ReactRouter.useNavigate`, `Vitest.test`, and `NodeFs.readFile`.
Use separate namespaces for CodeMirror's state, view, and commands modules.
Keep Effect's module imports (`Effect`, `Stream`, `Atom`, etc.): they already
provide namespaces. Keep named imports from `@effect/atom-react` and Vitest's
`vi` namespace. Direct component and type imports are fine.

Modules organized around a primary handle or definition name that type `Interface`,
so callers use `Host.Interface` or `Plugin.Interface`. Use `Service` for the Effect
context key and `layer` for its provider when dependency injection is needed;
modules do not need to expose either merely to follow the convention. Constructors
use `make`, while operations such as `define` and `load` keep their specific names.
Supporting types retain names such as `State`, `Options`, and `Loaded`.

## Type safety

Prefer code the compiler can verify. When a typing limitation requires opting out
of a check, follow Rust's `SAFETY` convention by explaining why the operation is
valid and which assumptions the author and reviewer must verify. Keep the
suppression local and use `@ts-expect-error` so the compiler reports when it is
no longer needed.

```ts
const colors = Object.freeze({
  primary: "#5e6f9c",
  muted: "#a09b94",
});

type ColorName = keyof typeof colors;

// SAFETY: colors is created here with exactly these enumerable string keys.
// Freezing it prevents additional keys from being added.
// @ts-expect-error Object.keys returns string[] rather than the known key union.
const names: readonly ColorName[] = Object.keys(colors);
```

## Commits and PRs

Commits and pull requests help people understand what the code alone cannot
convey, so clear, thoughtful writing is an essential part of the work.

Walls of text and lists of edits leave the reader to work out what matters.
Take the time to think clearly about what the person or agent reading your
commit or PR needs to understand, then organize your explanation around those ideas.

Use a short imperative title. Explain motivation, non-obvious tradeoffs, and
new capabilities, with length proportional to what needs explaining. A title
alone can suffice.

Avoid section templates and routine testing reports.
Discuss testing when the approach changes or a result matters to the reviewer.
Interleave code snippets or pseudocode with prose when they make a new interface,
its usage, or a behavior change easier to understand.

These PRs and commit messages show how the explanation can fit the change.

- [marimo #11179](https://github.com/marimo-team/marimo/pull/11179) introduces a core model through its ownership boundaries, a small interface example, and a plan for migrating existing code.
- [marimo #11816](https://github.com/marimo-team/marimo/pull/11816) explains a shared protocol definition through examples of generating a schema, implementing a host, and calling it from a client.
- [marimo-lsp #450](https://github.com/marimo-team/marimo-lsp/pull/450) uses before-and-after diagrams to explain a debugger rewrite, then follows a debugging request through the new design.
- [marimo #11625](https://github.com/marimo-team/marimo/pull/11625) explains why an earlier design made sense, what changed, and why removing it is now appropriate.
- [BurntSushi's commit messages in uv #789](https://github.com/astral-sh/uv/pull/789/commits) explain a performance change through its representation, measurements, and alternatives, distinguishing hypotheses from observed results.

## Checks

```sh
bun run check
bun run format
bun run test
bun run test:coverage
bun run build
```
