# @moku/outputs

React views for a marimo execution's displays, console output, and result.

```tsx
import { useAtomValue } from "@effect/atom-react";
import type * as Notebook from "@moku/core/Notebook";
import * as Outputs from "@moku/core/Outputs";
import { CellOutputs, Provider } from "@moku/outputs";

function ExecutionOutputs({
  notebook,
  executionId,
}: {
  notebook: Notebook.Interface;
  executionId: string;
}) {
  const state = useAtomValue(notebook.state);
  const outputs = Outputs.forExecution(state.value, executionId);
  return (
    <Provider notebook={notebook}>
      <CellOutputs {...outputs} />
    </Provider>
  );
}
```

`CellOutputs` renders an output snapshot; `DisplayView` and `ConsoleOutput` render
individual parts. `Provider` connects interactive outputs to the notebook runtime.
Use the notebook's atom registry; one notebook can have interactive outputs per page.

`bun setup` builds the embedded renderer from the pinned GitHub revision.
Use `MARIMO_CHECKOUT=../marimo bun setup` to build from a local checkout.
