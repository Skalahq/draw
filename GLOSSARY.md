# Draw

Draw is an embeddable canvas for building custom editors. The same canvas primitive supports different sets of tools and node types.

## Language

**Canvas**:
The interactive drawing surface that displays a document and lets an end user edit its contents.

**Document**:
The serializable contents of a canvas. The current viewport, selection, and in-progress gesture are not part of the document.

**Node**:
An item placed on a canvas, such as a freehand stroke or a host-defined component node.

**Group**:
A persistent container for nodes and nested groups. Its members can be moved together or edited individually without dissolving the group.

**Connection**:
A directed link between nodes, shown as an arrow by default. It does not pass values or run logic.

**Port**:
A named attachment point on a node. It anchors a connection to a specific part of the node without implying a type or behavior.

**Metadata**:
A serializable object attached to a node or connection. Its contents are opaque to Draw.

**Tool**:
An editing mode that interprets input on a canvas, such as drawing a stroke or inserting a node.

**Editor**:
The host experience around a canvas: toolbars, sidebars, navigation, and persistence.
_Avoid_: Canvas (the surface inside the editor)

**Workspace**:
A collection of canvases in the demo editor. It is not part of a Draw document.
