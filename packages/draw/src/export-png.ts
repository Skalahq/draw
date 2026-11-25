import type { Bounds, Point } from "./core.js";
import { flattenPath } from "./export-path.js";

export type PaintMark = Readonly<
  | { kind: "rect"; x: number; y: number; width: number; height: number; fill?: string; stroke?: string; strokeWidth?: number }
  | {
    kind: "path";
    d: string;
    fill?: string;
    stroke?: string;
    strokeWidth?: number;
    lineCap?: "butt" | "round" | "square";
    lineJoin?: "miter" | "round" | "bevel";
    transform?: string;
  }
>;

type Rgb = readonly [number, number, number];

const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let crc = n;
  for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  crcTable[n] = crc;
}

function pngColor(color: string | undefined): Rgb | undefined {
  if (!color || color === "none") return;
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color);
  if (!match) throw new TypeError(`Invalid export color: ${color}`);
  const hex = match[1].length === 3 ? match[1].replace(/./g, (part) => part + part) : match[1];
  return [Number.parseInt(hex.slice(0, 2), 16), Number.parseInt(hex.slice(2, 4), 16), Number.parseInt(hex.slice(4, 6), 16)];
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set([type.charCodeAt(0), type.charCodeAt(1), type.charCodeAt(2), type.charCodeAt(3)], 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

function adler32(data: Uint8Array): number {
  let s1 = 1;
  let s2 = 0;
  for (const byte of data) {
    s1 = (s1 + byte) % 65521;
    s2 = (s2 + s1) % 65521;
  }
  return (s2 << 16) | s1;
}

function zlibStore(data: Uint8Array): Uint8Array {
  const blocks: Uint8Array[] = [new Uint8Array([0x78, 0x01])];
  let stored = 0;
  for (let offset = 0; offset < data.length || offset === 0; offset += 65535) {
    const slice = data.subarray(offset, Math.min(data.length, offset + 65535));
    const header = new Uint8Array(5);
    header[0] = offset + slice.length >= data.length ? 1 : 0;
    header[1] = slice.length & 0xff;
    header[2] = slice.length >> 8;
    header[3] = ~slice.length & 0xff;
    header[4] = (~slice.length >> 8) & 0xff;
    blocks.push(header, slice);
    stored += slice.length;
    if (data.length === 0) break;
  }
  const checksum = adler32(data.subarray(0, stored));
  const tail = new Uint8Array(4);
  new DataView(tail.buffer).setUint32(0, checksum);
  blocks.push(tail);
  const length = blocks.reduce((sum, block) => sum + block.length, 0);
  const out = new Uint8Array(length);
  let cursor = 0;
  for (const block of blocks) {
    out.set(block, cursor);
    cursor += block.length;
  }
  return out;
}

function encodePng(width: number, height: number, pixels: Uint8Array): Uint8Array {
  const stride = width * 4;
  const scanlines = new Uint8Array(height * (stride + 1));
  for (let row = 0; row < height; row++) {
    scanlines.set(pixels.subarray(row * stride, (row + 1) * stride), row * (stride + 1) + 1);
  }
  const ihdr = new Uint8Array(13);
  const header = new DataView(ihdr.buffer);
  header.setUint32(0, width);
  header.setUint32(4, height);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const parts = [signature, chunk("IHDR", ihdr), chunk("IDAT", zlibStore(scanlines)), chunk("IEND", new Uint8Array())];
  const png = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let cursor = 0;
  for (const part of parts) {
    png.set(part, cursor);
    cursor += part.length;
  }
  return png;
}

function paint(pixels: Uint8Array, width: number, x: number, y: number, color: Rgb) {
  const offset = (y * width + x) * 4;
  pixels[offset] = color[0];
  pixels[offset + 1] = color[1];
  pixels[offset + 2] = color[2];
  pixels[offset + 3] = 255;
}

function segmentHits(px: number, py: number, ax: number, ay: number, bx: number, by: number, radius: number, cap: "butt" | "round" | "square"): boolean {
  let x1 = ax;
  let y1 = ay;
  let x2 = bx;
  let y2 = by;
  if (cap === "square") {
    const length = Math.hypot(x2 - x1, y2 - y1);
    if (length) {
      const scale = radius / length;
      x1 -= (x2 - x1) * scale;
      y1 -= (y2 - y1) * scale;
      x2 += (bx - ax) * scale;
      y2 += (by - ay) * scale;
    }
  }
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return cap !== "butt" && Math.hypot(px - x1, py - y1) <= radius;
  const t = ((px - x1) * dx + (py - y1) * dy) / lengthSquared;
  if (cap === "butt" && (t < 0 || t > 1)) return false;
  const clamped = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - (x1 + clamped * dx), py - (y1 + clamped * dy)) <= radius;
}

function containsPolygon(x: number, y: number, points: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const current = points[i];
    const previous = points[j];
    const crosses = (current.y > y) !== (previous.y > y)
      && x < (previous.x - current.x) * (y - current.y) / (previous.y - current.y) + current.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

function paintRect(pixels: Uint8Array, imageWidth: number, imageHeight: number, originX: number, originY: number, scale: number, mark: Extract<PaintMark, { kind: "rect" }>) {
  const fill = pngColor(mark.fill);
  const stroke = pngColor(mark.stroke);
  const radius = (mark.strokeWidth ?? 1) / 2;
  const pad = stroke ? radius : 0;
  const x0 = Math.max(0, Math.floor((mark.x - pad - originX) * scale));
  const y0 = Math.max(0, Math.floor((mark.y - pad - originY) * scale));
  const x1 = Math.min(imageWidth, Math.ceil((mark.x + mark.width + pad - originX) * scale));
  const y1 = Math.min(imageHeight, Math.ceil((mark.y + mark.height + pad - originY) * scale));
  const right = mark.x + mark.width;
  const bottom = mark.y + mark.height;
  for (let y = y0; y < y1; y++) {
    const docY = originY + (y + 0.5) / scale;
    for (let x = x0; x < x1; x++) {
      const docX = originX + (x + 0.5) / scale;
      const inside = docX >= mark.x && docX < right && docY >= mark.y && docY < bottom;
      if (fill && inside) paint(pixels, imageWidth, x, y, fill);
      if (!stroke) continue;
      const nearestX = Math.max(mark.x, Math.min(right, docX));
      const nearestY = Math.max(mark.y, Math.min(bottom, docY));
      const outside = Math.hypot(docX - nearestX, docY - nearestY);
      const distance = outside > 0 ? outside : Math.min(docX - mark.x, right - docX, docY - mark.y, bottom - docY);
      if (distance <= radius) paint(pixels, imageWidth, x, y, stroke);
    }
  }
}

function paintPath(pixels: Uint8Array, imageWidth: number, imageHeight: number, originX: number, originY: number, scale: number, mark: Extract<PaintMark, { kind: "path" }>) {
  const fill = pngColor(mark.fill);
  const stroke = pngColor(mark.stroke);
  const radius = (mark.strokeWidth ?? 1) / 2;
  const cap = mark.lineCap ?? "butt";
  const polylines = flattenPath(mark.d, mark.transform, 0.35 / scale);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const polyline of polylines) {
    for (const point of polyline) {
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    }
  }
  if (!Number.isFinite(minX)) return;
  const pad = stroke ? radius : 0;
  const x0 = Math.max(0, Math.floor((minX - pad - originX) * scale));
  const y0 = Math.max(0, Math.floor((minY - pad - originY) * scale));
  const x1 = Math.min(imageWidth, Math.ceil((maxX + pad - originX) * scale));
  const y1 = Math.min(imageHeight, Math.ceil((maxY + pad - originY) * scale));
  for (let y = y0; y < y1; y++) {
    const docY = originY + (y + 0.5) / scale;
    for (let x = x0; x < x1; x++) {
      const docX = originX + (x + 0.5) / scale;
      let color: Rgb | undefined;
      if (fill) {
        for (const polyline of polylines) {
          const closed = polyline.length > 2 && polyline[0].x === polyline.at(-1)?.x && polyline[0].y === polyline.at(-1)?.y;
          const polygon = closed ? polyline.slice(0, -1) : polyline;
          if (polygon.length >= 3 && containsPolygon(docX, docY, polygon)) color = fill;
        }
      }
      if (stroke) {
        for (const polyline of polylines) {
          for (let i = 1; i < polyline.length; i++) {
            const from = polyline[i - 1];
            const to = polyline[i];
            if (segmentHits(docX, docY, from.x, from.y, to.x, to.y, radius, cap)) color = stroke;
          }
        }
      }
      if (color) paint(pixels, imageWidth, x, y, color);
    }
  }
}

export function rasterizeScene(frame: Bounds, background: string, marks: readonly PaintMark[], scale: number): { png: Uint8Array; width: number; height: number } {
  const width = Math.max(1, Math.round(frame.width * scale));
  const height = Math.max(1, Math.round(frame.height * scale));
  const pixels = new Uint8Array(width * height * 4);
  const paper = pngColor(background) ?? [255, 255, 255];
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = paper[0];
    pixels[i + 1] = paper[1];
    pixels[i + 2] = paper[2];
    pixels[i + 3] = 255;
  }
  for (const mark of marks) {
    if (mark.kind === "rect") paintRect(pixels, width, height, frame.x, frame.y, scale, mark);
    else paintPath(pixels, width, height, frame.x, frame.y, scale, mark);
  }
  return { png: encodePng(width, height, pixels), width, height };
}
