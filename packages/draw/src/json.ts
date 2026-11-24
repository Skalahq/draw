import type { ConnectionEndpoint, DrawConnection, DrawDocument, DrawNode, Metadata } from "./core.js";
import { isValidStrokeNode, strokeNodeType } from "./stroke.js";

function readJsonObject(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const prototype = Object.getPrototypeOf(value);
  if (prototype === Object.prototype || prototype === null) return value as Record<string, unknown>;
}

function isKey(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isJsonValue(value: unknown, ancestors: Set<object>): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object") return false;
  if (ancestors.has(value)) return false;
  ancestors.add(value);
  if (Array.isArray(value)) {
    for (const child of value) {
      if (!isJsonValue(child, ancestors)) return false;
    }
  } else {
    const record = readJsonObject(value);
    if (!record) return false;
    for (const key in record) {
      if (Object.hasOwn(record, key) && !isJsonValue(record[key], ancestors)) return false;
    }
  }
  ancestors.delete(value);
  return true;
}

function isMetadata(value: unknown): value is Metadata {
  return readJsonObject(value) !== undefined && isJsonValue(value, new Set());
}

function readNode(input: unknown, index: number, ids: Set<string>): DrawNode {
  const value = readJsonObject(input);
  if (!value || !isKey(value.id) || !isKey(value.type) || ids.has(value.id)) {
    throw new TypeError(`Invalid Draw nodes[${index}]: expected a unique non-empty id and a non-empty type`);
  }
  const { id, type, metadata } = value;
  const bounds = readJsonObject(value.bounds);
  if (!bounds) throw new TypeError(`Invalid Draw nodes[${index}].bounds`);
  const { x, y, width, height } = bounds;
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(width) || !isFiniteNumber(height) || width <= 0 || height <= 0) {
    throw new TypeError(`Invalid Draw nodes[${index}].bounds: expected finite coordinates and positive dimensions`);
  }
  if (metadata !== undefined && !isMetadata(metadata)) {
    throw new TypeError(`Invalid Draw nodes[${index}].metadata: expected a JSON object with finite numbers`);
  }
  const node = { id, type, bounds: { x, y, width, height }, metadata };
  if (type === strokeNodeType && !isValidStrokeNode(node)) {
    throw new TypeError(`Invalid Draw nodes[${index}]: expected a freehand stroke inside its bounds`);
  }
  ids.add(id);
  return node;
}

function readEndpoint(input: unknown, index: number, end: string, nodeIds: Set<string>): ConnectionEndpoint {
  const value = readJsonObject(input);
  if (!value || !isKey(value.nodeId) || !nodeIds.has(value.nodeId) ||
      (value.portId !== undefined && !isKey(value.portId))) {
    throw new TypeError(`Invalid Draw connections[${index}].${end}: expected an existing node and an optional port id`);
  }
  return value.portId === undefined ? { nodeId: value.nodeId } : { nodeId: value.nodeId, portId: value.portId };
}

function readConnection(input: unknown, index: number, ids: Set<string>, nodeIds: Set<string>): DrawConnection {
  const value = readJsonObject(input);
  if (!value || !isKey(value.id) || ids.has(value.id)) {
    throw new TypeError(`Invalid Draw connections[${index}]: expected a unique non-empty id`);
  }
  if (value.metadata !== undefined && !isMetadata(value.metadata)) {
    throw new TypeError(`Invalid Draw connections[${index}].metadata: expected a JSON object with finite numbers`);
  }
  ids.add(value.id);
  return {
    id: value.id,
    source: readEndpoint(value.source, index, "source", nodeIds),
    target: readEndpoint(value.target, index, "target", nodeIds),
    metadata: value.metadata,
  };
}

function readVersion1(value: Record<string, unknown>): DrawDocument {
  if (!Array.isArray(value.nodes)) throw new TypeError("Invalid Draw document: expected a nodes array");
  const nodes: DrawNode[] = [];
  const nodeIds = new Set<string>();
  for (const node of value.nodes) nodes.push(readNode(node, nodes.length, nodeIds));
  if (value.connections === undefined) return { version: 1, nodes };
  if (!Array.isArray(value.connections)) throw new TypeError("Invalid Draw document: expected a connections array");
  const connections: DrawConnection[] = [];
  const connectionIds = new Set<string>();
  for (const connection of value.connections) connections.push(readConnection(connection, connections.length, connectionIds, nodeIds));
  return { version: 1, nodes, connections };
}

function readDocument(input: unknown): DrawDocument {
  const value = readJsonObject(input);
  if (!value) throw new TypeError("Invalid Draw document: expected an object");
  const { version } = value;
  if (!Number.isInteger(version)) throw new TypeError("Invalid Draw document version: expected an integer");
  switch (version) {
    case 1: return readVersion1(value);
    default: throw new TypeError(`Unsupported Draw document version: ${version}`);
  }
}

/** Serialize the committed document in the current editable JSON format. */
export function encodeDrawDocument(document: DrawDocument): string {
  return JSON.stringify(readDocument(document));
}

/** Validate and decode a portable document before opening it in a new controller. */
export function decodeDrawDocument(json: string): DrawDocument {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch (cause) {
    throw new SyntaxError("Invalid Draw JSON", { cause });
  }
  return readDocument(value);
}
