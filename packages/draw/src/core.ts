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

/** A group id is never a node id. Nested groups list child group ids in `memberIds`. */
export type DrawGroup = Readonly<{
  id: string;
  memberIds: readonly string[];
}>;

export type DrawDocument = Readonly<{
  version: 1;
  nodes: readonly DrawNode[];
  connections?: readonly DrawConnection[];
  groups?: readonly DrawGroup[];
}>;

export type DrawCommands = {
  insertNode(node: DrawNode): boolean;
  moveNode(id: string, position: Point): boolean;
  resizeNode(id: string, size: Size): boolean;
  deleteNode(id: string): boolean;
  insertConnection(connection: DrawConnection): boolean;
  reconnectConnection(id: string, end: ConnectionEnd, endpoint: ConnectionEndpoint): boolean;
  deleteConnection(id: string): boolean;
  group(memberIds: readonly string[]): boolean;
  ungroup(groupId: string): boolean;
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

function freezeGroup(id: string, memberIds: readonly string[]): DrawGroup {
  return Object.freeze({ id, memberIds: Object.freeze(memberIds.slice()) });
}

function ownGroup(group: DrawGroup): DrawGroup {
  return freezeGroup(group.id, group.memberIds);
}

function validEndpoint(endpoint: ConnectionEndpoint | undefined, hasNode: (id: string) => boolean): boolean {
  return !!endpoint && typeof endpoint.nodeId === "string" && hasNode(endpoint.nodeId) &&
    (endpoint.portId === undefined || (typeof endpoint.portId === "string" && endpoint.portId.length > 0));
}

function validConnection(connection: DrawConnection, hasNode: (id: string) => boolean): boolean {
  return typeof connection?.id === "string" && connection.id.length > 0 &&
    validEndpoint(connection.source, hasNode) && validEndpoint(connection.target, hasNode);
}

function documentOf(
  nodes: readonly DrawNode[],
  connections?: readonly DrawConnection[],
  groups?: readonly DrawGroup[],
): DrawDocument {
  const frozenNodes = Object.freeze(nodes);
  const frozenConnections = connections ? Object.freeze(connections) : undefined;
  const frozenGroups = groups?.length ? Object.freeze(groups) : undefined;
  if (frozenConnections && frozenGroups) {
    return Object.freeze({ version: 1, nodes: frozenNodes, connections: frozenConnections, groups: frozenGroups });
  }
  if (frozenConnections) return Object.freeze({ version: 1, nodes: frozenNodes, connections: frozenConnections });
  if (frozenGroups) return Object.freeze({ version: 1, nodes: frozenNodes, groups: frozenGroups });
  return Object.freeze({ version: 1, nodes: frozenNodes });
}

function validPoint({ x, y }: Point): boolean {
  return Number.isFinite(x) && Number.isFinite(y);
}

function validSize({ width, height }: Size): boolean {
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0;
}

function groupsOf(document: DrawDocument): readonly DrawGroup[] {
  return document.groups ?? [];
}

function groupById(document: DrawDocument, id: string): DrawGroup | undefined {
  return document.groups?.find((group) => group.id === id);
}

/** Parent group of a node or nested group, if it has one. Membership is never inferred from bounds. */
export function parentGroupId(document: DrawDocument, id: string): string | undefined {
  return document.groups?.find((group) => group.memberIds.includes(id))?.id;
}

function groupIndex(document: DrawDocument): Map<string, DrawGroup> {
  return new Map(groupsOf(document).map((group) => [group.id, group]));
}

/** Node ids reached by explicit nested membership. */
export function descendantNodeIds(document: DrawDocument, groupId: string): readonly string[] {
  const byId = groupIndex(document);
  if (!byId.has(groupId)) return [];
  const nodes: string[] = [];
  const seen = new Set<string>();
  const walk = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    const group = byId.get(id);
    if (!group) return;
    for (const member of group.memberIds) {
      if (byId.has(member)) walk(member);
      else nodes.push(member);
    }
  };
  walk(groupId);
  return nodes;
}

/** Nested group ids inside a group, not including the group itself. */
export function descendantGroupIds(document: DrawDocument, groupId: string): readonly string[] {
  const byId = groupIndex(document);
  const groups: string[] = [];
  const seen = new Set<string>([groupId]);
  const walk = (id: string) => {
    const group = byId.get(id);
    if (!group) return;
    for (const member of group.memberIds) {
      if (!byId.has(member) || seen.has(member)) continue;
      seen.add(member);
      groups.push(member);
      walk(member);
    }
  };
  walk(groupId);
  return groups;
}

/** Axis-aligned bounds of a group's descendant nodes. Undefined when the group is missing or empty. */
export function getGroupBounds(document: DrawDocument, groupId: string): Bounds | undefined {
  const ids = new Set(descendantNodeIds(document, groupId));
  let bounds: Bounds | undefined;
  for (const node of document.nodes) {
    if (!ids.has(node.id)) continue;
    const { x, y, width, height } = node.bounds;
    if (!bounds) {
      bounds = { x, y, width, height };
      continue;
    }
    const left = Math.min(bounds.x, x);
    const top = Math.min(bounds.y, y);
    bounds = {
      x: left,
      y: top,
      width: Math.max(bounds.x + bounds.width, x + width) - left,
      height: Math.max(bounds.y + bounds.height, y + height) - top,
    };
  }
  return bounds;
}

function membershipCycle(groups: readonly DrawGroup[]): boolean {
  const byId = new Map(groups.map((group) => [group.id, group]));
  const state = new Map<string, 0 | 1 | 2>();
  const visit = (id: string): boolean => {
    const mark = state.get(id) ?? 0;
    if (mark === 1) return true;
    if (mark === 2) return false;
    state.set(id, 1);
    for (const member of byId.get(id)?.memberIds ?? []) {
      if (byId.has(member) && visit(member)) return true;
    }
    state.set(id, 2);
    return false;
  };
  return groups.some((group) => visit(group.id));
}

function validateGroups(
  groups: readonly DrawGroup[] | undefined,
  nodeIds: ReadonlySet<string>,
  connectionIds: ReadonlySet<string>,
): DrawGroup[] | undefined {
  if (!groups?.length) return;
  const ids = new Set<string>();
  for (const group of groups) {
    if (!group || typeof group.id !== "string" || group.id.length === 0 || ids.has(group.id) ||
        nodeIds.has(group.id) || connectionIds.has(group.id) || !Array.isArray(group.memberIds) ||
        group.memberIds.length === 0) {
      throw new TypeError(`Invalid group in Draw snapshot: ${group?.id}`);
    }
    ids.add(group.id);
  }
  const members = new Set<string>();
  for (const group of groups) {
    const local = new Set<string>();
    for (const member of group.memberIds) {
      if (typeof member !== "string" || member.length === 0 || local.has(member) || members.has(member) ||
          member === group.id || (!nodeIds.has(member) && !ids.has(member))) {
        throw new TypeError(`Invalid group in Draw snapshot: ${group.id}`);
      }
      local.add(member);
      members.add(member);
    }
  }
  if (membershipCycle(groups)) throw new TypeError(`Invalid group in Draw snapshot: ${groups[0]?.id}`);
  return groups.map(ownGroup);
}

function ancestorIds(document: DrawDocument, id: string): Set<string> {
  const ancestors = new Set<string>();
  let parent = parentGroupId(document, id);
  while (parent && !ancestors.has(parent)) {
    ancestors.add(parent);
    parent = parentGroupId(document, parent);
  }
  return ancestors;
}

function withoutMembers(groups: readonly DrawGroup[], removed: ReadonlySet<string>): readonly DrawGroup[] | undefined {
  let next = groups.filter((group) => !removed.has(group.id))
    .map((group) => freezeGroup(group.id, group.memberIds.filter((id) => !removed.has(id))));
  let pruned = true;
  while (pruned) {
    pruned = false;
    const empty = new Set(next.filter((group) => group.memberIds.length === 0).map((group) => group.id));
    if (!empty.size) break;
    pruned = true;
    next = next.filter((group) => !empty.has(group.id))
      .map((group) => freezeGroup(group.id, group.memberIds.filter((id) => !empty.has(id))));
  }
  return next.length ? next : undefined;
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
  const groups = validateGroups(initial?.groups, ids, connectionIds);
  let current = documentOf(nodes, connections, groups);
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

  function edit(
    nodes: readonly DrawNode[],
    connections: readonly DrawConnection[] | undefined = current.connections,
    groups: readonly DrawGroup[] | null = current.groups ?? null,
  ): true {
    past.push(current);
    future.length = 0;
    return publish(documentOf(nodes, connections, groups ?? undefined));
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

  function allocateGroupId(): string {
    const used = new Set<string>([
      ...current.nodes.map((node) => node.id),
      ...groupsOf(current).map((group) => group.id),
      ...(current.connections ?? []).map((connection) => connection.id),
    ]);
    let number = 1;
    while (used.has(`group-${number}`)) number += 1;
    return `group-${number}`;
  }

  function translateGroup(id: string, position: Point): boolean {
    const origin = getGroupBounds(current, id);
    const descendants = descendantNodeIds(current, id);
    if (!origin || !descendants.length) return false;
    const dx = position.x - origin.x;
    const dy = position.y - origin.y;
    if (dx === 0 && dy === 0) return false;
    const moving = new Set(descendants);
    const nodes = current.nodes.map((node) => moving.has(node.id)
      ? Object.freeze({ ...node, bounds: Object.freeze({ ...node.bounds, x: node.bounds.x + dx, y: node.bounds.y + dy }) })
      : node);
    return edit(nodes);
  }

  function deleteIds(removedNodes: ReadonlySet<string>, removedGroups: ReadonlySet<string>): boolean {
    if (!removedNodes.size && !removedGroups.size) return false;
    const nodes = current.nodes.filter((node) => !removedNodes.has(node.id));
    const incident = (edge: DrawConnection) => removedNodes.has(edge.source.nodeId) || removedNodes.has(edge.target.nodeId);
    const connections = current.connections;
    const nextConnections = connections?.some(incident) ? connections.filter((edge) => !incident(edge)) : connections;
    const removed = new Set<string>([...removedNodes, ...removedGroups]);
    return edit(nodes, nextConnections, current.groups ? withoutMembers(current.groups, removed) ?? null : null);
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
            current.nodes.some(({ id }) => id === node.id) || groupById(current, node.id)) return false;
        return edit([...current.nodes, ownNode(node)]);
      },
      moveNode(id, point) {
        if (!validPoint(point)) return false;
        return groupById(current, id) ? translateGroup(id, point) : updateBounds(id, { x: point.x, y: point.y });
      },
      resizeNode(id, size) {
        return validSize(size) && updateBounds(id, { width: size.width, height: size.height });
      },
      deleteNode(id) {
        if (groupById(current, id)) {
          const removedGroups = new Set([id, ...descendantGroupIds(current, id)]);
          return deleteIds(new Set(descendantNodeIds(current, id)), removedGroups);
        }
        if (!hasNode(id)) return false;
        return deleteIds(new Set([id]), new Set());
      },
      insertConnection(connection) {
        const connections = current.connections ?? [];
        if (!validConnection(connection, hasNode) || connections.some(({ id }) => id === connection.id) ||
            groupById(current, connection.id)) return false;
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
      group(memberIds) {
        if (memberIds.length < 2 || new Set(memberIds).size !== memberIds.length) return false;
        const grouped = new Set(groupsOf(current).map((group) => group.id));
        const nodeIds = new Set(current.nodes.map((node) => node.id));
        if (memberIds.some((id) => !nodeIds.has(id) && !grouped.has(id))) return false;
        const parent = parentGroupId(current, memberIds[0]);
        if (memberIds.some((id) => parentGroupId(current, id) !== parent)) return false;
        for (const id of memberIds) {
          const ancestors = ancestorIds(current, id);
          if (memberIds.some((other) => other !== id && (other === id || ancestors.has(other) || ancestorIds(current, other).has(id)))) {
            return false;
          }
        }
        const id = allocateGroupId();
        const created = freezeGroup(id, memberIds);
        const removed = new Set<string>(memberIds);
        let inserted = false;
        const groups = groupsOf(current).map((group) => {
          if (group.id !== parent) return group;
          const next: string[] = [];
          for (const member of group.memberIds) {
            if (!removed.has(member)) next.push(member);
            else if (!inserted) {
              next.push(id);
              inserted = true;
            }
          }
          return freezeGroup(group.id, next);
        });
        return edit(current.nodes, current.connections, [...groups, created]);
      },
      ungroup(groupId) {
        const group = groupById(current, groupId);
        const groups = current.groups;
        if (!group || !groups) return false;
        const next = groups.flatMap((candidate) => {
          if (candidate.id === groupId) return [];
          if (!candidate.memberIds.includes(groupId)) return [candidate];
          return [freezeGroup(candidate.id, candidate.memberIds.flatMap((id) => id === groupId ? group.memberIds : [id]))];
        });
        return edit(current.nodes, current.connections, next);
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
