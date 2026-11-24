# Draw owns document edits; hosts own persistence

The Draw controller owns the live document and undo history. Canvas interactions, tools, and host UI use the same commands so that inserting a node from a sidebar has the same history semantics as inserting it on the canvas. Each completed gesture commits one edit; cancellation discards the preview without changing history.

Snapshots contain serializable node and connection metadata, not renderer instances, viewport state, selection, or live gestures. Connections describe relationships and never execute host logic. Unknown node types render as placeholders without discarding their data or connections, so a document can round-trip through a host with a different set of registered types.

Import validates and migrates the snapshot before replacing the live document. An unsupported version leaves the open canvas untouched.

Draw exports an optional persistence binding over an asynchronous `load(documentId)` and `save(documentId, snapshot)` interface. The demo uses IndexedDB; a host can use a backend without changing the canvas. The binding serializes saves for each document and coalesces pending snapshots. A save failure leaves edits in memory, reports unsaved state, and allows retry. Workspace storage and multi-writer conflict resolution are outside this contract.
