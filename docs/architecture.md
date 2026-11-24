# Draw v1 architecture

Proposed for sign-off. Draw is a UI SDK canvas primitive packaged for the npm ecosystem. The Next.js demo is a consumer, not part of the library. Two editor configurations must work against the same package: a workflow canvas with live component nodes and connections, and a sketch canvas with freehand drawing and groups.

## Repository and package

Use Bun workspaces with `packages/draw` and `apps/demo`. Use Bun for dependency installation, scripts, builds, tests, and packing; keep `bun.lock` and replace the initial Vite/npm scaffold. The demo depends on Draw through its workspace package name and public exports. It must not import package internals.

| Entry | Responsibility |
| --- | --- |
| `core` | Framework-neutral document, controller, commands, tools, geometry, codecs, and persistence contract. Importable without React or browser globals. |
| `react` | React 19 canvas parts and render hooks built on UI SDK. Browser interaction runs in a Next.js client component; React is a peer dependency, not bundled. |
| `dom` | Mount, update, and dispose a Draw canvas from browser JavaScript. Solid hosts can use this entry without React. |

Publish scoped structural styles with the package. Hosts can replace visual styling; only consumers that opt in load the UI SDK default theme. Keep the npm package name provisional until publication.

## Document and editing

- A versioned document holds stable IDs, node types, node bounds, stacking order, group membership, and directed connections. A freehand stroke is a node. A node or connection carries a serializable metadata object whose contents are opaque to Draw. Component instances and runtime UI state are not document data.
- Use one controller per open document. It exposes commands, snapshots, and committed-change subscriptions. Canvas tools and host UI call the same commands. Camera, selection, active tool, and previews are session state; undo and redo affect document edits. Opening a saved snapshot starts fresh history and selection.
- Export select, pan, insert-node, connect, and freehand tools. Hosts choose which tools to expose and can register tools using the same coordinate conversion and command interface. Group and ungroup are commands.
- Each completed gesture commits once; previews do not notify persistence or enter history. Escape and pointer cancellation discard the preview. Programmatic edits use the same history as direct edits.
- Groups are explicit, nested containers. Editing a member does not require ungrouping. Moving a group moves its descendants; it does not scale them. Ungroup keeps member positions. Deleting a group deletes its descendants and their incident connections in one edit.
- Connections attach to a node boundary or a named node-local port. Reconnecting either endpoint is a document edit. Missing ports fall back to the node boundary without losing the port ID; deleting a node removes its incident connections atomically. Draw supplies a default path without obstacle routing. Connections carry no execution semantics.

## Rendering and input

Draw owns the camera, document geometry, placement, selection, and hit testing. Render live components in DOM and strokes and connections in SVG, using the same view transform. Nodes and strokes share stacking order; connections sit behind nodes by default, and transient handles and previews sit above the document.

A host resolves a stable node type to a renderer. React hosts can render React content directly; other runtimes can mount, update, and dispose content in Draw-owned DOM containers. Unknown types keep their bounds, metadata, and connections and render as placeholders. Node bounds come from the document; renderers request a resize through a command rather than implicitly changing geometry through CSS.

The host can customize node content, connection lines, and arrowheads separately. Draw supplies arrowhead position and direction. A replacement path provides geometry that Draw can use for hit testing. Renderer choices do not change what the document means.

Support mouse, touch, and pen. Interactive content gets native focus and pointer events; a dedicated handle or non-interactive shell moves its node. Canvas shortcuts must not capture editing keys from inputs. Provide keyboard access to insertion, selection, movement, connection, grouping, and undo; freehand is pointer-based.

### Performance

Profile pan, zoom, drag, and freehand on a fixture with about 1,000 nodes plus connections. Use compositor-friendly transforms where they help, keep pointer previews out of the document commit path, and avoid updating unrelated component renderers. Use the browser's GPU-backed compositing where available; add bespoke GPU rendering only if profiling identifies a bottleneck that warrants it. The working editor is the release requirement, not a universal frame-rate guarantee.

## Persistence and export

Draw exports a small asynchronous `load(documentId)` / `save(documentId, snapshot)` contract and an optional controller binding. Canvas editing works without a persistence adapter. The binding serializes saves per document, coalesces pending work to the latest snapshot, exposes saving/saved/failed state, and supports retry and flush. A failed save leaves edits in memory. The demo flushes before switching documents or warns about unsaved changes. Concurrent-writer resolution is outside v1.

The Next.js editor implements the contract with IndexedDB. Workspace lists, canvas titles, and editor preferences are demo data, not Draw document fields. A backend adapter can replace IndexedDB for document snapshots without modifying Draw. Accounts, cross-device sharing, and real-time collaboration are outside the demo's v1 scope.

- **JSON:** editable round trip. Validate and migrate supported versions before replacing an open document. Reject unsupported versions or invalid contents without changing the open canvas. Keep unknown node types intact within a supported version.
- **SVG and PNG:** export the same visual representation. Default to whole-document content bounds, with optional crop and PNG scale; exclude camera, editor UI, and transient overlays. Built-in content exports directly. Custom content supplies a visual export representation; unsupported content is reported, never silently omitted.

## Build order and release checks

1. Set up the Bun workspace and package exports. Build document commands, snapshot validation, and undo/redo independently of any renderer.
2. Build the shared UI SDK canvas behavior, camera, geometry, and built-in tools. Wire the React and DOM adapters to the same controller and behavior.
3. Add the persistence binding and export pipeline. Build the Next.js workspace editor around the public package.
4. Verify real consumers against a tarball produced by `bun pm pack`, not just workspace links.

The release is ready when:

- The Next.js workflow canvas renders React and Solid nodes, keeps arrows attached to named ports while nodes move, and renders a custom arrowhead. A separate sketch canvas draws, groups, ungroups, and edits freehand nodes with the same package.
- A plain-JS fixture mounts the DOM entry without React. A second host configuration can change the toolset and renderers without modifying Draw.
- Drag, cancel, reconnect, delete, and group operations have the agreed history and attachment behavior; keyboard commands and native component inputs do not conflict.
- The demo creates, saves, switches, and reopens canvases. A delayed or failing save does not lose newer edits. JSON round-trips and both visual formats export through the public package.
- A clean consumer can install the packed artifact with Bun and resolve all public entries, styles, and types. The representative large document is profiled in the browser before release.

## Decision records

- [Framework-neutral canvas core](adr/0001-framework-neutral-canvas-core.md)
- [Document editing and persistence ownership](adr/0002-draw-owns-document-edits.md)
- [DOM and SVG rendering](adr/0003-render-live-dom-and-svg.md)
