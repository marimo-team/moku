# @momo/outputs

React components for marimo display data, console output, and execution outcomes.

```tsx
import { CellOutputs } from "@momo/outputs";
import * as Outputs from "@momo/model/Outputs";
import type * as Notebook from "@momo/model/Notebook";

function ExecutionOutputs({
  snapshot,
  executionId,
}: {
  snapshot: Notebook.Snapshot;
  executionId: string;
}) {
  const outputs = Outputs.forExecution(snapshot, executionId);
  return <CellOutputs {...outputs} />;
}
```

`CellOutputs` interleaves displays and console chunks in sequence order, then
renders the execution's value, error, interruption, or skip message. Choose the
execution in your app; the components receive data and do not subscribe to a notebook.

Use `DisplayView` and `ConsoleOutput` independently when your layout separates
results from the console:

```tsx
import { ConsoleOutput, DisplayView } from "@momo/outputs";

<DisplayView data={{ mimetype: "application/json", data: '{"answer":42}' }} />
<ConsoleOutput chunks={consoleChunks} />
```

Props derive from `@momo/model/Protocol`. `DisplayViewProps`, `ConsoleOutputProps`,
`CellOutputsProps`, and `OutputItem` are exported for wrappers and custom layouts.
JSON data is encoded as text; binary display data is base64, as in the host protocol.
Console chunks preserve their text and stdout/stderr channel.

Rich displays lazily load the bundled marimo renderer and its scoped stylesheet.
Plain text and console output render immediately. Use `setTheme("light" | "dark")`
to match your app's appearance; it updates all rich outputs without loading the
renderer early. Rich HTML uses marimo's rendering behavior. Widget sessions, function calls,
and runtime asset routes are not connected yet.

Build the embedded renderer before using the package:

```sh
bun run --filter @momo/outputs build
```

The build uses `~/github/marimo-team/marimo`, with its frontend dependencies already
installed. Set `MARIMO_CHECKOUT` or pass a checkout path after `build` to use another
checkout. Generated files live in `dist/` and are ignored by version control.
The build records the upstream revision and emits declarations from the typed
bundle entry. Workspace typechecking uses those declarations without traversing
the upstream frontend.
