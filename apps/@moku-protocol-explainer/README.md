# Protocol explainer

An interactive introduction to the host protocol’s object model and event streams.

```sh
bun run --cwd apps/@moku-protocol-explainer dev
```

Open `http://127.0.0.1:5180` to read the overview and object model. As the article
scrolls, the illustration introduces a cell’s source, identity, and configuration,
then its relationship to the document, notebook, host, and storage. These reveals
explain the model; they are not protocol events. Scrolling backward revisits earlier
concepts. The connection example below follows an actual sequence of simulated
requests and events, with playback controlled independently of scrolling.

Press Connect in that example. A request travels to the host, then the
streaming response opens a persistent connection. Parsing the source creates the
complete host notebook, including its document and cell records, in one step. The cells
contain `x = 10` and `print(x)`, providing a dependency for a later execution lesson.
This lesson does not run them. Playback pauses before sending anything to the client.

The notebook visually contains its document and cells, but each remains an independent
protocol record with its own event and inspector.

A compact toolbar keeps the chapter, playback, speed, and scrubbing controls available
above a diagram sized to its contents in a centered workspace. The lower detail panel
follows the diagram immediately, without a viewport-height spacer. Larger notebooks
scroll within the diagram.

The grid gives the client and host memory the main space. A small storage reference
represents the saved source; clicking it opens the complete file. The file is one
persistence format, while the host owns the live objects and decides what its storage
implementation persists when notebook.save is requested.

Continue to watch transient events carry copies across that same connection. The host
keeps its records and the client stores a record only when its event arrives. The ready
marker completes the snapshot without closing the stream. Events travel only along the
horizontal stream. Matching colors and record IDs connect each envelope to its
highlighted source and arriving replica. Drag the timeline to hold a handoff in flight,
advance one step, or click an object, file, or moving envelope to inspect it in the
detail panel below the scene. Cell config rows show a compact preview and expand in
place without opening that panel. Choose 0.25×, 0.5×, 1×, or 2× beside the timeline to
adjust speed without restarting playback.

This is a deterministic illustration of an unloaded file-backed host, not a live trace
of marimo OSS. The timing of loading and response headers is an implementation choice.
The filtered stream follows notebook, cell, and document records from the pinned
protocol. This notebook has no runtime or retained outputs.

React renders the scene from the timeline position. Effect owns playback and
subscriptions within a scope, interrupting pending animation frames when paused,
seeking, or unmounting. The app is isolated from the launcher and Moku core, with local
styles following Moku’s warm palette.

Run `bun setup` from the repository root on a fresh checkout to prepare the vendored
client and install workspace dependencies. The explainer is included in the workspace
lockfile and can be developed independently of the launcher.

```sh
bun run --cwd apps/@moku-protocol-explainer test
bun run --cwd apps/@moku-protocol-explainer build
```
