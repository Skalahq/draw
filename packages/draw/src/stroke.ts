import type { Bounds, DrawNode, Point } from "./core.js";

export const strokeNodeType = "draw:stroke";
export const strokeWidth = 4;
const radius = strokeWidth / 2;

function strokePoints(node: DrawNode): readonly Point[] | undefined {
  const points = node.metadata?.points;
  if (node.type !== strokeNodeType || !Array.isArray(points) || !points.length) return;
  const { x, y, width, height } = node.bounds;
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(width) || !Number.isFinite(height) ||
      width < strokeWidth || height < strokeWidth) return;

  // Viewport conversion can leave a centerline infinitesimally outside its inset.
  const inset = radius - 1e-7;
  for (const point of points) {
    if (point === null || typeof point !== "object" || Array.isArray(point) ||
        !Number.isFinite(point.x) || !Number.isFinite(point.y) ||
        point.x < inset || point.x > width - inset || point.y < inset || point.y > height - inset) return;
  }
  return points;
}

export function isValidStrokeNode(node: DrawNode): boolean {
  return strokePoints(node) !== undefined;
}

export function getStrokeGeometry(node: DrawNode): { bounds: Bounds; d: string } | undefined {
  const points = strokePoints(node);
  if (!points) return;
  const first = points[0];
  let d = `M${first.x} ${first.y}`;
  if (points.length === 1) d += `L${first.x} ${first.y}`;
  else for (let i = 1; i < points.length; i++) d += `L${points[i].x} ${points[i].y}`;
  return { bounds: node.bounds, d };
}

export function createStrokeNode(id: string, points: readonly Point[]): DrawNode {
  let { x: left, y: top } = points[0];
  let right = left;
  let bottom = top;
  for (let i = 1; i < points.length; i++) {
    const { x, y } = points[i];
    left = Math.min(left, x);
    top = Math.min(top, y);
    right = Math.max(right, x);
    bottom = Math.max(bottom, y);
  }
  return {
    id,
    type: strokeNodeType,
    bounds: { x: left - radius, y: top - radius, width: right - left + strokeWidth, height: bottom - top + strokeWidth },
    metadata: { points: points.map(({ x, y }) => ({ x: x - left + radius, y: y - top + radius })) },
  };
}

export function strokeContainsPoint(node: DrawNode, x: number, y: number): boolean {
  const points = strokePoints(node);
  if (!points) return false;
  x -= node.bounds.x;
  y -= node.bounds.y;
  let start = points[0];
  for (const end of points) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const offsetX = x - start.x;
    const offsetY = y - start.y;
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, (offsetX * dx + offsetY * dy) / lengthSquared));
    const distanceX = offsetX - t * dx;
    const distanceY = offsetY - t * dy;
    if (distanceX * distanceX + distanceY * distanceY <= radius * radius) return true;
    start = end;
  }
  return false;
}
