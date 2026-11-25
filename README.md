# Draw

Draw is an embeddable canvas. The host owns its controls and node content; Draw owns document edits and history.

## Run the demo

```sh
bun install --frozen-lockfile
bun run --bun playwright install chromium
bun run check
```

On Linux, use `bun run --bun playwright install --with-deps chromium` if Chromium's system dependencies are missing. The smoke tests start and stop their own production server; no credentials or running dev server are needed.

For local editing, install [Portless](https://github.com/vercel-labs/portless) globally, then run `bun run dev` and open the named URL it prints. Run `PORTLESS=0 bun run dev` to bypass the proxy. Portless is not needed for `bun run check`.

Open `/workflow` on the demo server to try live React and Solid nodes, an unregistered node, and the committed document snapshot. Open `/sketch` to draw freehand alongside editable note nodes. Open `/workspaces` to create, name, and reopen canvases from IndexedDB.

## Embed in React 19

Import `createDrawController` and the tools from `@skalahq/draw/core`, `DrawCanvas` from `@skalahq/draw/react`, and `@skalahq/draw/styles.css` once. The canvas needs a height from its host. React and React DOM are supplied by the host, not bundled.

Create one controller per open document and pass it to `DrawCanvas`. Host controls and tools both call `controller.commands`; read committed data with `getSnapshot()` or listen with `subscribeCommitted(listener)`, which returns an unsubscribe function. Snapshots are immutable. Undo and redo publish snapshots, but selection, the viewport, and drag previews never do.

Pass the active `tool` explicitly: `selectTool`, `panTool`, `insertNodeTool(createNode)`, `freehandTool`, or a host-defined `CanvasTool`. With no active tool, pointer presses don't edit the document. The demo's **Stamp marker** tool converts its pointer release from client pixels to canvas units with `context.toCanvas`, then inserts through `context.commands.insertNode`.

- Select moves a node by dragging its shell or the visible ink of a stroke. Drag the selected component node's bottom-right handle to resize; Escape cancels either gesture.
- Use Pan to drag the viewport, or scroll to pan and Ctrl/⌘-scroll to zoom. With canvas focus, `+`, `-`, and `0` control zoom.
- With an insertion tool active, Enter inserts at the viewport center. `[` and `]` cycle the selection, arrows move it (Shift for larger steps), and Delete removes it. Ctrl/⌘+Z undoes; add Shift to redo.
- Freehand draws with a mouse, touch, or pen. Release commits one stroke; Escape or pointer cancellation discards the preview. Strokes can move but do not resize.

The structural CSS only positions the canvas, nodes, and handles. Style `.draw-node[data-selected]`, `.draw-move`, and `.draw-resize` in the host for visible affordances. `getNodeLabel` gives each node an accessible name.

### Render live nodes

Pass `nodeRenderers` to resolve each stable document node type. Use `{ render: MyComponent }` for React content. For content from another runtime, use `{ mount(container) { … } }`. `mount` receives a Draw-owned container and returns `{ update(props), dispose() }`. Draw calls `update` after mounting and when the committed node changes; `dispose` releases the runtime and clears its content when the renderer is replaced, the node is removed, or the canvas unmounts. Keep renderer entries stable across host rerenders to avoid remounting them.

Both renderers receive `NodeRenderProps`: the immutable `node` and a `resize({ width, height })` command returning whether the bounds changed. DOM layout doesn't write bounds. The content keeps native input and focus; use the separate Move button to drag, or activate it with the keyboard and use the canvas arrows.

The existing `renderNode(node)` callback still works and is the fallback for types not listed in `nodeRenderers`. Without fallback content, unregistered types in a registry-backed canvas use a movable placeholder without changing the document.

### Built-in stroke snapshots

`strokeNodeType` reserves `draw:stroke`. Its `metadata.points` holds a nonempty, ordered array of finite `{ x, y }` samples in canvas units relative to the node's bounds origin. The path has round caps and joins and a `strokeWidth` of 4 canvas units. Bounds enclose the ink, including its 2-unit radius; a single sample is a dot. Other metadata keys remain opaque.

`getStrokeGeometry(node)` returns the node bounds and its node-local SVG path `d`; translate that path by the bounds origin to draw it in document coordinates.

### Groups

A group is a document member, not a node. `DrawGroup` is `{ id, memberIds }`, and `DrawDocument.groups` is omitted when there are none. A group id never collides with a node or connection id. Nested groups list child group ids in `memberIds`; membership is explicit and is never inferred from bounds. Overlapping nodes stay ungrouped until a command says otherwise.

`commands.group(memberIds)` requires at least two existing nodes or groups that share a parent, including the root. It returns false for a connection id, a single member, mixed parents, or an ancestor grouped with its descendant. The new id is the smallest unused `group-n`, inserted where the first selected member sat. `commands.ungroup(groupId)` splices that group's members back into its parent and leaves positions and connection endpoints unchanged.

`moveNode(groupId, position)` treats `position` as the top-left of the descendant bounds and translates every descendant by that delta. Width, height, and stroke points stay the same. Moving or resizing a member does not dissolve the group. `deleteNode(groupId)` removes that group, nested groups, descendant nodes, and connections incident to those nodes in one edit. Undo restores membership, positions, and connections.

On a canvas, Shift-click adds nodes, strokes, connections, and groups to the selection. `g` or Control+G groups the selected nodes and groups. `G` or Control+Shift+G ungroups the selected group, or the shared parent when every selected member belongs to one. `[` and `]` cycle nodes and groups; Delete removes the primary node or group. Arrow keys move a selected group the same way they move a node. Open `/groups` in the demo to try a component node, a stroke, and a connection together.

## Editable JSON

Open `/json` in the demo to download the committed drawing with **Export JSON**, or open a `.json` file with **Import JSON**. The file preserves document order and host metadata, including metadata on node types the current host cannot render.

```ts
import { createDrawController, decodeDrawDocument, encodeDrawDocument } from "@skalahq/draw/core";

const json = encodeDrawDocument(controller.getSnapshot());
const reopened = createDrawController(decodeDrawDocument(json));
```

The codec supports version 1. Decoding throws on invalid JSON, invalid document contents, or an unsupported version, so construct the replacement controller before switching away from the current one. The file contains no camera, selection, active tool, gestures, or history. Mount a fresh canvas (in React, use a new `key`) with the new controller to reset its session state.

JSON is a portable file format, not a persistence adapter. For a persisted editor, validate first, flush or resolve outstanding saves for the open document, and then bind the replacement controller to storage. Explicitly save its initial imported snapshot: opening a controller is not an edit and doesn't emit a committed change.

## Persist a document

Canvas editing does not require storage. A host that wants it implements `load(documentId)` / `save(documentId, snapshot)` and passes that adapter to `createDrawPersistence`. `snapshot` is the string from `encodeDrawDocument`; `load` returns that string or `undefined` when nothing is stored. Draw decodes with `decodeDrawDocument` before the host opens a controller.

```ts
import { createDrawController, createDrawPersistence } from "@skalahq/draw/core";

const storage = new Map<string, string>();
const persistence = createDrawPersistence({
  async load(documentId) {
    return storage.get(documentId);
  },
  async save(documentId, snapshot) {
    storage.set(documentId, snapshot);
  },
});
const snapshot = await persistence.load(documentId);
const controller = createDrawController(snapshot);
persistence.save(documentId, controller.getSnapshot());
const unbind = persistence.bind(controller, documentId);
await persistence.flush(documentId);
```

Saves for one document run one at a time. A save requested while another is in flight replaces any snapshot still waiting, so storage receives the latest document rather than every intermediate. `getState` and `subscribe` report `saving`, `saved`, or `failed`. A failed save leaves the open document and its undo history unchanged. Further edits replace the snapshot `retry` will send; Draw does not call the adapter again until `retry`. `flush` waits for the latest in-flight snapshot and rejects when the latest attempt failed, so a host can flush before switching or warn and stay. Opening a saved snapshot in a new controller starts a fresh history. Titles, workspace lists, and editor preferences are host data, not document fields.
## Export SVG and PNG

Open `/export` in the demo to download the committed drawing. Export reads the document snapshot, so pan, zoom, selection, and an in-progress stroke do not change the file. Built-in notes export as labeled rectangles and strokes export through `getStrokeGeometry` without a host renderer. Connections reuse `getConnectionGeometry`, including the host path and ports.

```ts
import { exportDrawPng, exportDrawSvg, type DrawNodeExport } from "@skalahq/draw/core";

const exported = exportDrawSvg(controller.getSnapshot(), {
  crop: { x: 40, y: 48, width: 160, height: 72 },
  getNodeLabel: (node) => typeof node.metadata?.label === "string" ? node.metadata.label : node.type,
  exportNode(node): DrawNodeExport | undefined {
    if (node.type === "badge") return [{ kind: "rect", x: 0, y: 0, width: node.bounds.width, height: node.bounds.height, fill: "#779961" }];
    if (node.type === "widget") return "unsupported";
  },
});
const png = exportDrawPng(controller.getSnapshot(), { scale: 2 });
```

Omit `crop` to frame the exportable ink. `scale` changes PNG pixels only; SVG user units stay in document coordinates. `exportNode` marks are node-local. Return `"unsupported"` to list a node in `unsupported` instead of drawing a placeholder. An omitted callback, or `undefined`, uses the built-in stroke or labeled rectangle. Invalid marks throw rather than disappearing.
