# @moku/core

Observe and operate on marimo notebooks through scoped Effect values.

## Connect and read state

```ts
import { Effect, Redacted } from "effect";
import { FetchHttpClient } from "effect/http";
import { AtomRegistry } from "effect/reactivity";
import * as Host from "@moku/core/Host";

const program = Effect.gen(function* () {
  const registry = yield* AtomRegistry.AtomRegistry;
  const host = yield* Host.make({
    baseUrl: "http://localhost:2718/api/marimo/v1",
    token: Redacted.make("your-host-token"),
  });
  const notebook = yield* host.notebooks.attach("n1");
  const state = registry.get(notebook.state);
  yield* Effect.log(state);
});

await Effect.runPromise(
  program.pipe(
    Effect.scoped,
    Effect.provide(FetchHttpClient.layer),
    Effect.provide(AtomRegistry.layer),
  ),
);
```

Attachments to the same notebook share state. Keep each caller's scope open while
using it; the last release stops observation and interrupts outstanding commands.

## Show cells in React

```tsx
import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";

const state = useAtomValue(notebook.state);

return AsyncResult.match(state, {
  onInitial: () => <Spinner />,
  onFailure: () => <ErrorMessage />,
  onSuccess: ({ value }) =>
    value.document?.cells.map((cell) => <Cell key={cell.id} cell={cell} />),
});
```

Use the same registry that acquired the notebook.

## Edit cells

```ts
const edited =
  yield *
  notebook.edit((tx) => {
    tx.updateCell(cell, { code: "x = 42", config: { disabled: false } });
    const id = tx.createCell({ code: "y = 2" });
    tx.createCell({ code: "print(y)" }, { after: id });
  });
```

Changes apply atomically and fail if an observed cell has changed. Updates
preserve unspecified fields, including individual config settings.

## Save a confirmed revision

```ts
yield * notebook.save(edited.document);
```

Saving fails if the document revision has changed.

## Run cells

```ts
yield * notebook.ensureRunning;
yield * notebook.runtime.run({ cells: edited.cells });
```

Running fails if an observed cell has changed. The call returns when the run is
accepted, and callers may follow execution through `notebook.state` using the
accepted `run.id`.

## Read the host catalog

```ts
import { AsyncResult } from "effect/reactivity";

const state = registry.get(host.state);
if (AsyncResult.isSuccess(state)) {
  yield * Effect.log(state.value.notebooks);
}
```
