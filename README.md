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

## Embed in React 19

Import `createDrawController` and the tools from `@skalahq/draw/core`, `DrawCanvas` from `@skalahq/draw/react`, and `@skalahq/draw/styles.css` once. The canvas needs a height from its host. React and React DOM are supplied by the host, not bundled.

Create one controller per open document and pass it to `DrawCanvas`. Host controls and tools both call `controller.commands`; read committed data with `getSnapshot()` or listen with `subscribeCommitted(listener)`, which returns an unsubscribe function. Snapshots are immutable. Undo and redo publish snapshots, but selection, the viewport, and drag previews never do.

Pass the active `tool` explicitly: `selectTool`, `panTool`, `insertNodeTool(createNode)`, or a host-defined `CanvasTool`. With no active tool, pointer presses don't edit the document. The demo's **Stamp marker** tool converts its pointer release from client pixels to canvas units with `context.toCanvas`, then inserts through `context.commands.insertNode`.

- Select moves a node by dragging its shell. Drag the selected node's bottom-right handle to resize; Escape cancels either gesture.
- Use Pan to drag the viewport, or scroll to pan and Ctrl/⌘-scroll to zoom. With canvas focus, `+`, `-`, and `0` control zoom.
- With an insertion tool active, Enter inserts at the viewport center. `[` and `]` cycle the selection, arrows move it (Shift for larger steps), and Delete removes it. Ctrl/⌘+Z undoes; add Shift to redo.

The structural CSS only positions the canvas, nodes, and handles. Style `.draw-node[data-selected]` and `.draw-resize` in the host for a visible selection and resize affordance. `renderNode` supplies node content, and `getNodeLabel` gives each node an accessible name.
