import { isValidStrokeNode, strokeNodeType } from "./stroke.js";

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

export type ConnectionEndpoint = Readonly<{ nodeId: string; portId?: string }>;
export type ConnectionEnd = "source" | "target";
export type DrawConnection = Readonly<{
  id: string;
  source: ConnectionEndpoint;
  target: ConnectionEndpoint;
  metadata?: Metadata;
}>;

export type DrawDocument = Readonly<{
  version: 1;
  nodes: readonly DrawNode[];
  connections?: readonly DrawConnection[];
}>;

export type DrawCommands = {
  insertNode(node: DrawNode): boolean;
  moveNode(id: string, position: Point): boolean;
  resizeNode(id: string, size: Size): boolean;
  deleteNode(id: string): boolean;
  insertConnection(connection: DrawConnection): boolean;
  reconnectConnection(id: string, end: ConnectionEnd, endpoint: ConnectionEndpoint): boolean;
  deleteConnection(id: string): boolean;
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

function ownConnection(connection: DrawConnection): DrawConnection {
  const metadata = connection.metadata === undefined ? undefined : structuredClone(connection.metadata);
  if (metadata) freezeMetadata(metadata);
  return Object.freeze({
    ...connection, source: Object.freeze({ ...connection.source }), target: Object.freeze({ ...connection.target }), metadata,
  });
}

function validEndpoint(endpoint: ConnectionEndpoint | undefined, hasNode: (id: string) => boolean): boolean {
  return !!endpoint && typeof endpoint.nodeId === "string" && hasNode(endpoint.nodeId) &&
    (endpoint.portId === undefined || (typeof endpoint.portId === "string" && endpoint.portId.length > 0));
}

function validConnection(connection: DrawConnection, hasNode: (id: string) => boolean): boolean {
  return typeof connection?.id === "string" && connection.id.length > 0 &&
    validEndpoint(connection.source, hasNode) && validEndpoint(connection.target, hasNode);
}

function documentOf(nodes: readonly DrawNode[], connections?: readonly DrawConnection[]): DrawDocument {
  return Object.freeze(connections
    ? { version: 1, nodes: Object.freeze(nodes), connections: Object.freeze(connections) }
    : { version: 1, nodes: Object.freeze(nodes) });
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
    if (!node.id || !node.type || !validPoint(node.bounds) || !validSize(node.bounds) || ids.has(node.id) ||
        (node.type === strokeNodeType && !isValidStrokeNode(node))) {
      throw new TypeError(`Invalid node in Draw snapshot: ${node.id}`);
    }
    ids.add(node.id);
    return ownNode(node);
  }) ?? [];
  const connectionIds = new Set<string>();
  const hasInitialNode = (id: string) => ids.has(id);
  const connections = initial?.connections?.map((connection) => {
    if (!validConnection(connection, hasInitialNode) || connectionIds.has(connection.id)) {
      throw new TypeError(`Invalid connection in Draw snapshot: ${connection?.id}`);
    }
    connectionIds.add(connection.id);
    return ownConnection(connection);
  });
  let current = documentOf(nodes, connections);
  const hasNode = (id: string) => current.nodes.some((node) => node.id === id);
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

  function edit(nodes: readonly DrawNode[], connections = current.connections): true {
    past.push(current);
    future.length = 0;
    return publish(documentOf(nodes, connections));
  }

  function updateBounds(id: string, bounds: Partial<Bounds>): boolean {
    const index = current.nodes.findIndex((node) => node.id === id);
    if (index === -1) return false;
    const node = current.nodes[index];
    const next = { ...node.bounds, ...bounds };
    if (next.x === node.bounds.x && next.y === node.bounds.y &&
        next.width === node.bounds.width && next.height === node.bounds.height) return false;
    if (node.type === strokeNodeType && (next.width !== node.bounds.width || next.height !== node.bounds.height)) return false;
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
            (node.type === strokeNodeType && !isValidStrokeNode(node)) ||
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
        const connections = current.connections;
        const incident = (edge: DrawConnection) => edge.source.nodeId === id || edge.target.nodeId === id;
        return edit(nodes, connections?.some(incident) ? connections.filter((edge) => !incident(edge)) : connections);
      },
      insertConnection(connection) {
        const connections = current.connections ?? [];
        if (!validConnection(connection, hasNode) || connections.some(({ id }) => id === connection.id)) return false;
        return edit(current.nodes, [...connections, ownConnection(connection)]);
      },
      reconnectConnection(id, end, endpoint) {
        const connections = current.connections;
        if (!connections || !validEndpoint(endpoint, hasNode)) return false;
        const index = connections.findIndex((connection) => connection.id === id);
        if (index === -1) return false;
        const connection = connections[index];
        const previous = connection[end];
        if (previous.nodeId === endpoint.nodeId && previous.portId === endpoint.portId) return false;
        const next = connections.slice();
        next[index] = Object.freeze({ ...connection, [end]: Object.freeze({ ...endpoint }) });
        return edit(current.nodes, next);
      },
      deleteConnection(id) {
        const connections = current.connections;
        const index = connections?.findIndex((connection) => connection.id === id) ?? -1;
        if (!connections || index === -1) return false;
        const next = connections.slice();
        next.splice(index, 1);
        return edit(current.nodes, next);
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

export { connectTool, freehandTool, insertNodeTool, panTool, selectTool, type CanvasTool, type ToolContext, type ToolGesture } from "./tools.js";
export { decodeDrawDocument, encodeDrawDocument } from "./json.js";
export {
  createDrawPersistence,
  type DrawPersistence,
  type DrawPersistenceAdapter,
  type DrawPersistenceState,
  type DrawPersistenceStatus,
} from "./persistence.js";
export { getStrokeGeometry, isValidStrokeNode, strokeNodeType, strokeWidth } from "./stroke.js";
export {
  getConnectionGeometry, hitTestConnection, connectionArrowheadTransform, defaultArrowheadPath,
  type ArrowheadGeometry, type ConnectionAnchors, type ConnectionGeometry, type ConnectionGeometryOptions,
  type ConnectionPathSegment, type DrawPort,
} from "./connections.js";
export {
  exportDrawPng, exportDrawSvg,
  type DrawExportMark, type DrawExportOptions, type DrawExportUnsupported, type DrawNodeExport, type DrawPngExport, type DrawSvgExport,
} from "./export.js";
