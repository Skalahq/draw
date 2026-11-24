export type Point = Readonly<{ x: number; y: number }>;
export type Size = Readonly<{ width: number; height: number }>;
export type Bounds = Point & Size;
export type JsonValue = null | boolean | number | string | readonly JsonValue[] | Metadata;
export type Metadata = { readonly [key: string]: JsonValue };

export type DrawNode = Readonly<{
  id: string;
  type: string;
  bounds: Bounds;
  metadata?: Metadata;
}>;

export type DrawDocument = Readonly<{
  version: 1;
  nodes: readonly DrawNode[];
}>;

export type DrawCommands = {
  insertNode(node: DrawNode): boolean;
  moveNode(id: string, position: Point): boolean;
  resizeNode(id: string, size: Size): boolean;
  deleteNode(id: string): boolean;
  undo(): boolean;
  redo(): boolean;
};

type CommittedListener = (document: DrawDocument) => void;

export type DrawController = {
  commands: DrawCommands;
  getSnapshot(): DrawDocument;
  subscribeCommitted(listener: CommittedListener): () => void;
};

function freezeMetadata(value: JsonValue): void {
  if (value === null || typeof value !== "object") return;
  for (const child of Object.values(value)) freezeMetadata(child);
  Object.freeze(value);
}

function ownNode(node: DrawNode): DrawNode {
  const metadata = node.metadata === undefined ? undefined : structuredClone(node.metadata);
  if (metadata) freezeMetadata(metadata);
  return Object.freeze({ ...node, bounds: Object.freeze({ ...node.bounds }), metadata });
}

function documentOf(nodes: DrawNode[]): DrawDocument {
  return Object.freeze({ version: 1, nodes: Object.freeze(nodes) });
}

function validPoint({ x, y }: Point): boolean {
  return Number.isFinite(x) && Number.isFinite(y);
}

function validSize({ width, height }: Size): boolean {
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0;
}

export function createDrawController(initial?: DrawDocument): DrawController {
  const ids = new Set<string>();
  const nodes = initial?.nodes.map((node) => {
    if (!node.id || !node.type || !validPoint(node.bounds) || !validSize(node.bounds) || ids.has(node.id)) {
      throw new TypeError(`Invalid node in Draw snapshot: ${node.id}`);
    }
    ids.add(node.id);
    return ownNode(node);
  }) ?? [];
  let current = documentOf(nodes);
  const past: DrawDocument[] = [];
  const future: DrawDocument[] = [];
  const listeners = new Set<CommittedListener>();
  const pending: DrawDocument[] = [];

  function publish(document: DrawDocument): true {
    current = document;
    if (!listeners.size) return true;
    pending.push(document);
    if (pending.length > 1) return true;
    try {
      for (const snapshot of pending) {
        for (const listener of [...listeners]) {
          if (listeners.has(listener)) listener(snapshot);
        }
      }
    } finally {
      pending.length = 0;
    }
    return true;
  }

  function edit(nodes: DrawNode[]): true {
    past.push(current);
    future.length = 0;
    return publish(documentOf(nodes));
  }

  function updateBounds(id: string, bounds: Partial<Bounds>): boolean {
    const index = current.nodes.findIndex((node) => node.id === id);
    if (index === -1) return false;
    const node = current.nodes[index];
    const next = { ...node.bounds, ...bounds };
    if (next.x === node.bounds.x && next.y === node.bounds.y &&
        next.width === node.bounds.width && next.height === node.bounds.height) return false;
    const nodes = current.nodes.slice();
    nodes[index] = Object.freeze({ ...node, bounds: Object.freeze(next) });
    return edit(nodes);
  }

  return {
    getSnapshot: () => current,
    subscribeCommitted(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    commands: {
      insertNode(node) {
        if (!node.id || !node.type || !validPoint(node.bounds) || !validSize(node.bounds) ||
            current.nodes.some(({ id }) => id === node.id)) return false;
        return edit([...current.nodes, ownNode(node)]);
      },
      moveNode(id, point) {
        return validPoint(point) && updateBounds(id, { x: point.x, y: point.y });
      },
      resizeNode(id, size) {
        return validSize(size) && updateBounds(id, { width: size.width, height: size.height });
      },
      deleteNode(id) {
        const index = current.nodes.findIndex((node) => node.id === id);
        if (index === -1) return false;
        const nodes = current.nodes.slice();
        nodes.splice(index, 1);
        return edit(nodes);
      },
      undo() {
        const previous = past.pop();
        if (!previous) return false;
        future.push(current);
        return publish(previous);
      },
      redo() {
        const next = future.pop();
        if (!next) return false;
        past.push(current);
        return publish(next);
      },
    },
  };
}

export { insertNodeTool, panTool, selectTool, type CanvasTool, type ToolContext, type ToolGesture } from "./tools.js";
export { decodeDrawDocument, encodeDrawDocument } from "./json.js";
