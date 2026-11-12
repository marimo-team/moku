# @momo/outputs

Reusable React renderers for marimo display data, console output, and execution outcomes.

```ts
import { DisplayView, ConsoleOutput, CellOutputs } from "@momo/outputs";

// Proposed exports; not implemented yet.

DisplayView; // render MIME display data using the bundled marimo renderer
ConsoleOutput; // render ordered console chunks with their channel information
CellOutputs; // compose ordered display/console items and an execution outcome

// The caller selects which execution's outputs to show.
// The package owns rendering, not notebook subscriptions or draft state.
// Optional widget integration (also proposed):
// import * as OutputSession from "@momo/outputs/Session";
// const outputs = yield* OutputSession.make(notebook);
// A provider passes the session to renderers; the session owns transport wiring.
// Initially supports one active interactive session per page.
```
