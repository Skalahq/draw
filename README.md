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

Open `/workflow` on the demo server to try live React and Solid nodes, an unregistered node, and the committed document snapshot. Open `/sketch` to draw freehand alongside editable note nodes.

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

## Editable JSON

Open `/json` in the demo to download the committed drawing with **Export JSON**, or open a `.json` file with **Import JSON**. The file preserves document order and host metadata, including metadata on node types the current host cannot render.

```ts
import { createDrawController, decodeDrawDocument, encodeDrawDocument } from "@skalahq/draw/core";

const json = encodeDrawDocument(controller.getSnapshot());
const reopened = createDrawController(decodeDrawDocument(json));
```

The codec supports version 1. Decoding throws on invalid JSON, invalid document contents, or an unsupported version, so construct the replacement controller before switching away from the current one. The file contains no camera, selection, active tool, gestures, or history. Mount a fresh canvas (in React, use a new `key`) with the new controller to reset its session state.

JSON is a portable file format, not a persistence adapter. For a persisted editor, validate first, flush or resolve outstanding saves for the open document, and then bind the replacement controller to storage. Explicitly save its initial imported snapshot: opening a controller is not an edit and doesn't emit a committed change.
