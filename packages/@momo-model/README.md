# @momo/model

Effect services and reactive state for finding, observing, and operating on marimo notebooks.

```ts
import { Atom } from "effect/reactivity";
import * as Model from "@momo/model";
import * as Workspace from "@momo/model/Workspace";
import * as Notebook from "@momo/model/Notebook";

const runtime = Atom.runtime(Model.layer(baseUrl));
const workspaceAtom = runtime.atom(Workspace.make({ launchKey }));
const notebookAtom = runtime.atom(Notebook.make({ connectionId, notebookId }));
```

Mount these atoms through your app's AtomRegistry or `@effect/atom-react` to keep
their scopes alive. Use the same registry to read the atoms on the returned objects.
A workspace discovers host connections and exposes a catalog for each connection.
Omit `launchKey` to use an existing authenticated session.

A notebook exposes its live snapshot through `state` and its confirmed document
through `source`. Every operation accepts one options object:

```ts
notebook.edit({ request: { changes }, requestId });
notebook.save({ etag, requestId });
notebook.start({ requestId });
notebook.run({ request: { cells }, requestId });
notebook.cancel({ runId, requestId });
notebook.interrupt({ requestId });
notebook.stop({ requestId });
```

Operations return Effects. Give each logical request a unique `requestId` and reuse
it when retrying that same request. `save` and `start` also accept `decisions` when
the host asks for a choice. Cancel targets one run; interrupt targets runtime work.

`Notebook.Interface` describes an instance. `Notebook.layer(target)` provides it
as `Notebook.Service` for Effects that consume the current notebook. Closing its
scope stops observation and cancels in-flight requests.

`Outputs.forExecution(snapshot, executionId)`, imported from `@momo/model/Outputs`,
selects an execution's outcome and ordered display/console items for rendering.
