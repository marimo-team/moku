# @momo/client

Effect services and reactive state for finding, observing, and operating on marimo notebooks.

```ts
import * as Workspace from "@momo/client/Workspace";
import * as Notebook from "@momo/client/Notebook";

// Proposed exports; not implemented yet.

Workspace.make({ launchKey }); // scoped workspace; existing session if key omitted

workspace.connections; // host connections atom
workspace.catalog(connectionId); // notebook catalog atom for one connection
workspace.connect({ url, token }); // Effect: add a host and update connections
workspace.refresh; // Effect: refresh host connections

Notebook.attach({ connectionId, notebookId }); // scoped notebook attachment

notebook.target; // host connection and notebook identity
notebook.source; // confirmed document and edit availability atom
notebook.state; // notebook observation atom, including connection status

notebook.edit; // submit versioned document changes
notebook.save; // save a confirmed document revision
notebook.start; // start the notebook runtime
notebook.run; // run confirmed cells with their etags
notebook.interrupt; // interrupt runtime work
notebook.cancel; // cancel one run
notebook.stop; // stop the runtime

// Public types:
// Workspace.Workspace
// Workspace.Connection
// Workspace.Catalog
// Notebook.Handle
// Notebook.Target
// Notebook.Source
// Notebook.Confirmed
```
