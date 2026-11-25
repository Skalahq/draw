import type { Point } from "./core.js";

export type PathBox = Readonly<{ minX: number; minY: number; maxX: number; maxY: number }>;

type PathCommand =
  | { op: "M" | "L"; x: number; y: number }
  | { op: "Q"; x1: number; y1: number; x: number; y: number }
  | { op: "C"; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { op: "Z" };

const numberToken = /[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+)(?:e[-+]?\d+)?/gi;

function readNumber(tokens: readonly string[], index: number): number {
  const value = Number(tokens[index]);
  if (!Number.isFinite(value)) throw new TypeError("Invalid export path");
  return value;
}

export function parsePath(d: string): PathCommand[] {
  const tokens = d.match(numberToken);
  if (!tokens?.length) throw new TypeError("Invalid export path");
  const commands: PathCommand[] = [];
  let index = 0;
  let command = "";
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  while (index < tokens.length) {
    if (/[a-zA-Z]/.test(tokens[index])) command = tokens[index++];
    else if (!command) throw new TypeError("Invalid export path");
    const relative = command === command.toLowerCase();
    const op = command.toUpperCase();
    if (op === "Z") {
      commands.push({ op: "Z" });
      x = startX;
      y = startY;
      command = "";
      continue;
    }
    if (op === "M" || op === "L") {
      const nextX = readNumber(tokens, index++) + (relative ? x : 0);
      const nextY = readNumber(tokens, index++) + (relative ? y : 0);
      commands.push({ op: op === "M" ? "M" : "L", x: nextX, y: nextY });
      x = nextX;
      y = nextY;
      if (op === "M") {
        startX = x;
        startY = y;
        command = relative ? "l" : "L";
      }
    } else if (op === "H") {
      x = readNumber(tokens, index++) + (relative ? x : 0);
      commands.push({ op: "L", x, y });
    } else if (op === "V") {
      y = readNumber(tokens, index++) + (relative ? y : 0);
      commands.push({ op: "L", x, y });
    } else if (op === "Q") {
      const x1 = readNumber(tokens, index++) + (relative ? x : 0);
      const y1 = readNumber(tokens, index++) + (relative ? y : 0);
      const nextX = readNumber(tokens, index++) + (relative ? x : 0);
      const nextY = readNumber(tokens, index++) + (relative ? y : 0);
      commands.push({ op: "Q", x1, y1, x: nextX, y: nextY });
      x = nextX;
      y = nextY;
    } else if (op === "C") {
      const x1 = readNumber(tokens, index++) + (relative ? x : 0);
      const y1 = readNumber(tokens, index++) + (relative ? y : 0);
      const x2 = readNumber(tokens, index++) + (relative ? x : 0);
      const y2 = readNumber(tokens, index++) + (relative ? y : 0);
      const nextX = readNumber(tokens, index++) + (relative ? x : 0);
      const nextY = readNumber(tokens, index++) + (relative ? y : 0);
      commands.push({ op: "C", x1, y1, x2, y2, x: nextX, y: nextY });
      x = nextX;
      y = nextY;
    } else {
      throw new TypeError(`Unsupported export path command: ${command}`);
    }
  }
  return commands;
}

/** SVG transform lists apply right to left. Exports emit `translate() rotate()`. */
export function applyTransform(point: Point, transform?: string): Point {
  if (!transform) return point;
  let x = point.x;
  let y = point.y;
  const rotate = /rotate\(\s*([-+0-9.eE]+)\s*\)/.exec(transform);
  if (rotate) {
    const angle = Number(rotate[1]) * Math.PI / 180;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const nextX = x * cos - y * sin;
    y = x * sin + y * cos;
    x = nextX;
  }
  const translate = /translate\(\s*([-+0-9.eE]+)[\s,]+([-+0-9.eE]+)\s*\)/.exec(transform);
  if (translate) {
    x += Number(translate[1]);
    y += Number(translate[2]);
  }
  return { x, y };
}

function include(box: PathBox | undefined, point: Point, pad: number): PathBox {
  const minX = point.x - pad;
  const minY = point.y - pad;
  const maxX = point.x + pad;
  const maxY = point.y + pad;
  if (!box) return { minX, minY, maxX, maxY };
  return {
    minX: Math.min(box.minX, minX),
    minY: Math.min(box.minY, minY),
    maxX: Math.max(box.maxX, maxX),
    maxY: Math.max(box.maxY, maxY),
  };
}

export function pathBounds(d: string, transform: string | undefined, pad: number): PathBox | undefined {
  let box: PathBox | undefined;
  for (const command of parsePath(d)) {
    if (command.op === "Z") continue;
    const points = command.op === "C"
      ? [{ x: command.x1, y: command.y1 }, { x: command.x2, y: command.y2 }, { x: command.x, y: command.y }]
      : command.op === "Q"
        ? [{ x: command.x1, y: command.y1 }, { x: command.x, y: command.y }]
        : [{ x: command.x, y: command.y }];
    for (const point of points) box = include(box, applyTransform(point, transform), pad);
  }
  return box;
}

function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function flatEnough(from: Point, control: Point, to: Point, tolerance: number): boolean {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  return Math.abs((control.x - from.x) * dy - (control.y - from.y) * dx) / length <= tolerance;
}

function flattenQuadratic(from: Point, control: Point, to: Point, tolerance: number, into: Point[]) {
  if (flatEnough(from, control, to, tolerance)) {
    into.push(to);
    return;
  }
  const left = midpoint(from, control);
  const right = midpoint(control, to);
  const mid = midpoint(left, right);
  flattenQuadratic(from, left, mid, tolerance, into);
  flattenQuadratic(mid, right, to, tolerance, into);
}

function flattenCubic(from: Point, c1: Point, c2: Point, to: Point, tolerance: number, into: Point[]) {
  if (flatEnough(from, c1, to, tolerance) && flatEnough(from, c2, to, tolerance)) {
    into.push(to);
    return;
  }
  const ab = midpoint(from, c1);
  const bc = midpoint(c1, c2);
  const cd = midpoint(c2, to);
  const abbc = midpoint(ab, bc);
  const bccd = midpoint(bc, cd);
  const mid = midpoint(abbc, bccd);
  flattenCubic(from, ab, abbc, mid, tolerance, into);
  flattenCubic(mid, bccd, cd, to, tolerance, into);
}

export function flattenPath(d: string, transform: string | undefined, tolerance: number): Point[][] {
  const polylines: Point[][] = [];
  let current: Point[] = [];
  let start: Point | undefined;
  const move = (point: Point) => applyTransform(point, transform);
  for (const command of parsePath(d)) {
    if (command.op === "M") {
      if (current.length) polylines.push(current);
      const point = move(command);
      current = [point];
      start = point;
    } else if (command.op === "L") {
      current.push(move(command));
    } else if (command.op === "Q") {
      const from = current.at(-1);
      if (!from) throw new TypeError("Invalid export path");
      flattenQuadratic(from, move({ x: command.x1, y: command.y1 }), move(command), tolerance, current);
    } else if (command.op === "C") {
      const from = current.at(-1);
      if (!from) throw new TypeError("Invalid export path");
      flattenCubic(from, move({ x: command.x1, y: command.y1 }), move({ x: command.x2, y: command.y2 }), move(command), tolerance, current);
    } else if (start && current.length) {
      current.push(start);
      polylines.push(current);
      current = [];
      start = undefined;
    }
  }
  if (current.length) polylines.push(current);
  return polylines;
}
