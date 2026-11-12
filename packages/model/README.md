# @momo/model

Effect services and reactive state for finding, observing, and operating on marimo notebooks.

```ts
import * as Model from "@momo/model";
import * as Workspace from "@momo/model/Workspace";
import * as Notebook from "@momo/model/Notebook";

Model.layer(baseUrl); // transport layer; provide alongside an AtomRegistry

Workspace.make({ launchKey }); // scoped workspace; existing session if key omitted

workspace.connections; // host connections atom
workspace.status; // pending refresh/connection and error atom
workspace.catalog(connectionId); // notebook catalog atom for one connection
workspace.connect({ url, token }); // Effect: add a host and update connections
workspace.refresh; // Effect: refresh host connections

Notebook.make({ connectionId, notebookId }); // scoped notebook instance
Notebook.Service; // Context.Service for the current notebook
Notebook.layer({ connectionId, notebookId }); // provides Notebook.Service

notebook.target; // host connection and notebook identity
notebook.source; // confirmed document and edit availability atom
notebook.state; // notebook observation atom, including connection status

notebook.edit(request, requestId); // Effect: submit versioned document changes
notebook.save(etag, requestId); // Effect: save a confirmed document revision
notebook.start(requestId); // Effect: start the notebook runtime
notebook.run({ cells }, requestId); // Effect: run confirmed cells with their etags
notebook.interrupt(requestId); // Effect: interrupt runtime work
notebook.cancel(runId, requestId); // Effect: cancel one run
notebook.stop(requestId); // Effect: stop the runtime

// Public types:
// Workspace.Workspace
// Workspace.Connection
// Workspace.Catalog
// Notebook.Interface
// Notebook.Target
// Notebook.Source
// Notebook.Confirmed
```
