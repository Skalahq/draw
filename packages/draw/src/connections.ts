import type { Bounds, DrawConnection, DrawNode, Point } from "./core.js";

export type DrawPort = Readonly<{ id: string; position: Point; label?: string }>;
export type ConnectionAnchors = Readonly<{ source: Point; target: Point }>;
export type ConnectionPathSegment = Readonly<
  | { to: Point; control?: never; control1?: never; control2?: never }
  | { to: Point; control: Point; control1?: never; control2?: never }
  | { to: Point; control1: Point; control2: Point; control?: never }
>;
export type ArrowheadGeometry = Readonly<{ position: Point; direction: Point }>;
export type ConnectionGeometry = ConnectionAnchors & Readonly<{
  segments: readonly ConnectionPathSegment[];
  path: string;
  arrowhead: ArrowheadGeometry;
}>;
export type ConnectionGeometryOptions = {
  getPorts?: (node: DrawNode) => readonly DrawPort[];
  getConnectionPath?: (connection: DrawConnection, anchors: ConnectionAnchors) => readonly ConnectionPathSegment[];
};

export const defaultArrowheadPath = "M -10 -5 L 0 0 L -10 5 Z";
export function connectionArrowheadTransform({ position, direction }: ArrowheadGeometry): string {
  const angle = Math.atan2(direction.y, direction.x) * 180 / Math.PI;
  return `translate(${position.x} ${position.y}) rotate(${angle})`;
}

export function nodeCenter({ x, y, width, height }: Bounds): Point {
  return { x: x + width / 2, y: y + height / 2 };
}

export function portPosition(node: DrawNode, port: DrawPort): Point {
  return { x: node.bounds.x + port.position.x, y: node.bounds.y + port.position.y };
}

export function boundaryPosition(bounds: Bounds, toward: Point): Point {
  const center = nodeCenter(bounds);
  const dx = toward.x - center.x;
  const dy = toward.y - center.y;
  const scale = Math.max(Math.abs(dx) / (bounds.width / 2), Math.abs(dy) / (bounds.height / 2));
  return scale === 0 ? { x: bounds.x + bounds.width, y: center.y } : { x: center.x + dx / scale, y: center.y + dy / scale };
}

function direction(from: Point, to: Point): Point | undefined {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length) return { x: dx / length, y: dy / length };
}

export function getConnectionGeometry(
  connection: DrawConnection,
  getNode: (id: string) => DrawNode | undefined,
  options?: ConnectionGeometryOptions,
): ConnectionGeometry | undefined {
  const sourceNode = getNode(connection.source.nodeId);
  const targetNode = getNode(connection.target.nodeId);
  if (!sourceNode || !targetNode) return;
  const sourcePort = connection.source.portId && options?.getPorts?.(sourceNode).find((port) => port.id === connection.source.portId);
  const targetPort = connection.target.portId && options?.getPorts?.(targetNode).find((port) => port.id === connection.target.portId);
  const sourcePosition = sourcePort ? portPosition(sourceNode, sourcePort) : undefined;
  const targetPosition = targetPort ? portPosition(targetNode, targetPort) : undefined;
  const sourceCenter = nodeCenter(sourceNode.bounds);
  const targetCenter = nodeCenter(targetNode.bounds);
  const coincident = sourceCenter.x === targetCenter.x && sourceCenter.y === targetCenter.y;
  const source = sourcePosition ?? boundaryPosition(sourceNode.bounds,
    coincident ? { x: sourceCenter.x + 1, y: sourceCenter.y } : targetPosition ?? targetCenter);
  const target = targetPosition ?? boundaryPosition(targetNode.bounds,
    coincident ? { x: targetCenter.x, y: targetCenter.y - 1 } : sourcePosition ?? sourceCenter);
  const custom = options?.getConnectionPath?.(connection, { source, target });
  const last = custom?.at(-1)?.to;
  let segments: readonly ConnectionPathSegment[];
  if (custom) segments = last?.x === target.x && last.y === target.y ? custom : [...custom, { to: target }];
  else if (coincident) {
    const right = Math.max(sourceNode.bounds.x + sourceNode.bounds.width, targetNode.bounds.x + targetNode.bounds.width);
    const top = Math.min(sourceNode.bounds.y, targetNode.bounds.y);
    segments = [{ to: target, control1: { x: right + 45, y: source.y }, control2: { x: target.x, y: top - 45 } }];
  } else segments = [{ to: target }];

  let path = `M ${source.x} ${source.y}`;
  let tangent: Point | undefined;
  let from = source;
  for (const { to, control, control1, control2 } of segments) {
    path += control ? ` Q ${control.x} ${control.y} ${to.x} ${to.y}`
      : control1 && control2 ? ` C ${control1.x} ${control1.y} ${control2.x} ${control2.y} ${to.x} ${to.y}`
      : ` L ${to.x} ${to.y}`;
    tangent = (control2 && direction(control2, to)) ?? (control1 && direction(control1, to)) ??
      (control && direction(control, to)) ?? direction(from, to) ?? tangent;
    from = to;
  }
  return { source, target, segments, path, arrowhead: { position: target, direction: tangent ?? { x: 1, y: 0 } } };
}

function lineDistanceSquared(point: Point, from: Point, to: Point): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = dx * dx + dy * dy;
  const t = length ? Math.max(0, Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy) / length)) : 0;
  return (point.x - from.x - t * dx) ** 2 + (point.y - from.y - t * dy) ** 2;
}

function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export function hitTestConnection(geometry: ConnectionGeometry, point: Point, tolerance: number): boolean {
  const radiusSquared = tolerance * tolerance;
  // Subdivide only the branches whose control hull could contain the pointer.
  const flatnessSquared = radiusSquared / 256;
  function hits(from: Point, to: Point, first?: Point, second?: Point, depth = 0): boolean {
    if (!first) return lineDistanceSquared(point, from, to) <= radiusSquared;
    const other = second ?? first;
    if (point.x < Math.min(from.x, to.x, first.x, other.x) - tolerance ||
        point.x > Math.max(from.x, to.x, first.x, other.x) + tolerance ||
        point.y < Math.min(from.y, to.y, first.y, other.y) - tolerance ||
        point.y > Math.max(from.y, to.y, first.y, other.y) + tolerance) return false;
    if (depth === 16 || (lineDistanceSquared(first, from, to) <= flatnessSquared &&
        lineDistanceSquared(other, from, to) <= flatnessSquared)) {
      return lineDistanceSquared(point, from, to) <= radiusSquared;
    }
    const a = midpoint(from, first);
    const c = midpoint(other, to);
    if (!second) {
      const middle = midpoint(a, c);
      return hits(from, middle, a, undefined, depth + 1) || hits(middle, to, c, undefined, depth + 1);
    }
    const b = midpoint(first, second);
    const d = midpoint(a, b);
    const e = midpoint(b, c);
    const middle = midpoint(d, e);
    return hits(from, middle, a, d, depth + 1) || hits(middle, to, e, c, depth + 1);
  }
  let from = geometry.source;
  for (const { to, control, control1, control2 } of geometry.segments) {
    if (hits(from, to, control ?? control1, control2)) return true;
    from = to;
  }
  return false;
}
