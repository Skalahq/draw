import { inflateSync } from "node:zlib";
import { expect, test } from "bun:test";
import {
  connectionArrowheadTransform, createDrawController, defaultArrowheadPath, exportDrawPng, exportDrawSvg, getConnectionGeometry,
  getStrokeGeometry, strokeNodeType, type DrawDocument, type DrawNode, type DrawNodeExport,
} from "@skalahq/draw/core";

const note: DrawNode = { id: "note", type: "note", bounds: { x: 40, y: 48, width: 160, height: 72 }, metadata: { label: "Field note" } };
const badge: DrawNode = { id: "badge", type: "badge", bounds: { x: 280, y: 48, width: 120, height: 72 }, metadata: { label: "Badge" } };
const stroke: DrawNode = {
  id: "stroke",
  type: strokeNodeType,
  bounds: { x: 40, y: 140, width: 120, height: 20 },
  metadata: { points: [{ x: 2, y: 10 }, { x: 118, y: 10 }] },
};
const widget: DrawNode = { id: "widget", type: "live-widget", bounds: { x: 40, y: 200, width: 160, height: 72 }, metadata: { label: "Live widget" } };
const link = { id: "link", source: { nodeId: "note" }, target: { nodeId: "badge" } };
const document: DrawDocument = { version: 1, nodes: [note, badge, stroke, widget], connections: [link] };
const ink = [32, 58, 66, 255];
const paper = [255, 255, 255, 255];
const green = [119, 153, 97, 255];

function exportNode(node: DrawNode): DrawNodeExport | undefined {
  if (node.type === "badge") {
    return [
      { kind: "rect", x: 0, y: 0, width: node.bounds.width, height: node.bounds.height, fill: "#779961" },
      { kind: "text", x: 8, y: node.bounds.height / 2, text: "Badge", fill: "#ffffff" },
    ];
  }
  if (node.type === "live-widget") return "unsupported";
}

const options = { exportNode, getNodeLabel: (node: DrawNode) => typeof node.metadata?.label === "string" ? node.metadata.label : node.type };

function decodePng(png: Uint8Array) {
  expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  let offset = 8;
  let width = 0;
  let height = 0;
  const idat: Uint8Array[] = [];
  while (offset + 12 <= png.length) {
    const view = new DataView(png.buffer, png.byteOffset + offset, 8);
    const length = view.getUint32(0);
    const type = String.fromCharCode(png[offset + 4], png[offset + 5], png[offset + 6], png[offset + 7]);
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = new DataView(data.buffer, data.byteOffset, 8).getUint32(0);
      height = new DataView(data.buffer, data.byteOffset, 8).getUint32(4);
    } else if (type === "IDAT") idat.push(data);
    offset += 12 + length;
    if (type === "IEND") break;
  }
  const compressed = new Uint8Array(idat.reduce((sum, part) => sum + part.length, 0));
  let cursor = 0;
  for (const part of idat) {
    compressed.set(part, cursor);
    cursor += part.length;
  }
  const scanlines = inflateSync(compressed);
  const stride = width * 4;
  const pixels = new Uint8Array(width * height * 4);
  for (let row = 0; row < height; row++) {
    expect(scanlines[row * (stride + 1)]).toBe(0);
    pixels.set(scanlines.subarray(row * (stride + 1) + 1, (row + 1) * (stride + 1)), row * stride);
  }
  return { width, height, pixels };
}

function pixel(image: { width: number; pixels: Uint8Array }, x: number, y: number) {
  const start = (y * image.width + x) * 4;
  return [...image.pixels.subarray(start, start + 4)];
}

test("svg and png share built-in nodes, strokes, connections, and custom marks", () => {
  const before = JSON.stringify(document);
  const svg = exportDrawSvg(document, options);
  const png = exportDrawPng(document, options);
  expect(JSON.stringify(document)).toBe(before);
  expect(svg).toEqual(exportDrawSvg(document, options));
  expect(svg.width).toBe(360);
  expect(svg.height).toBe(104);
  expect(svg.svg).toContain('viewBox="40 48 360 104"');
  expect(svg.svg).toContain('overflow="hidden"');
  expect(svg.svg).toContain("<title>Field note</title>");
  expect(svg.svg).toContain("<title>Badge</title>");
  expect(svg.svg).toContain('fill="#779961"');
  expect(svg.svg).not.toContain("Live widget");
  expect(svg.svg).not.toContain("Secret widget chrome");
  expect(svg.svg).not.toContain("draw-resize");
  expect(svg.unsupported).toEqual([{ id: "widget", type: "live-widget" }]);

  const geometry = getConnectionGeometry(link, (id) => document.nodes.find((node) => node.id === id));
  const strokeGeometry = getStrokeGeometry(stroke);
  if (!geometry || !strokeGeometry) throw new Error("expected export geometry");
  expect(geometry.path).toBe("M 200 84 L 280 84");
  expect(svg.svg).toContain(`d="${geometry.path}"`);
  expect(svg.svg).toContain(`d="${defaultArrowheadPath}"`);
  expect(svg.svg).toContain(`transform="${connectionArrowheadTransform(geometry.arrowhead)}"`);
  expect(svg.svg).toContain(`d="${strokeGeometry.d}"`);
  expect(svg.svg).toContain('transform="translate(40 140)"');

  expect(png.width).toBe(360);
  expect(png.height).toBe(104);
  expect(png.unsupported).toEqual(svg.unsupported);
  const image = decodePng(png.png);
  expect(image.width).toBe(360);
  expect(image.height).toBe(104);
  expect(pixel(image, 0, 0)).toEqual(ink);
  expect(pixel(image, 20, 12)).toEqual(paper);
  expect(pixel(image, 320, 36)).toEqual(green);
  expect(pixel(image, 200, 36)).toEqual(ink);
  expect(pixel(image, 60, 102)).toEqual(ink);
  expect(pixel(image, 235, 34)).toEqual(ink);
  expect(pixel(image, 20, 82)).toEqual(paper);
});

test("crop and scale change the frame without reading the camera", () => {
  const crop = { x: 40, y: 48, width: 160, height: 72 };
  const cropped = exportDrawSvg(document, { ...options, crop, scale: 2 });
  expect(cropped.width).toBe(160);
  expect(cropped.height).toBe(72);
  expect(cropped.svg).toContain('viewBox="40 48 160 72"');
  expect(cropped.svg).toContain("Field note");
  expect(cropped.svg).not.toContain("Badge");
  expect(cropped.svg).not.toContain("#779961");
  const scaled = exportDrawPng(document, { ...options, scale: 2 });
  expect(scaled.width).toBe(720);
  expect(scaled.height).toBe(208);
  expect(exportDrawSvg(document, { ...options, scale: 2 }).width).toBe(360);
  const croppedPng = decodePng(exportDrawPng(document, { ...options, crop, scale: 2 }).png);
  expect(croppedPng.width).toBe(320);
  expect(croppedPng.height).toBe(144);
  expect(croppedPng.pixels.includes(119)).toBe(false);
  const zoomed = decodePng(scaled.png);
  expect(pixel(zoomed, 120, 204)).toEqual(ink);
});

test("custom paths, ports, and labels round-trip through the existing geometry helpers", () => {
  const left: DrawNode = { id: "left", type: "task", bounds: { x: 0, y: 0, width: 40, height: 40 }, metadata: { label: "A & B <task>" } };
  const right: DrawNode = { id: "right", type: "task", bounds: { x: 120, y: 80, width: 40, height: 40 } };
  const connection = { id: "curve", source: { nodeId: "left", portId: "out" }, target: { nodeId: "right" } };
  const nodes = [left, right];
  const geometryOptions = {
    getPorts: (node: DrawNode) => node.id === "left" ? [{ id: "out", position: { x: 40, y: 20 } }] : [],
    getConnectionPath: () => [{ control1: { x: 80, y: 0 }, control2: { x: 80, y: 100 }, to: { x: 120, y: 100 } }],
  };
  const geometry = getConnectionGeometry(connection, (id) => nodes.find((node) => node.id === id), geometryOptions);
  const exported = exportDrawSvg({ version: 1, nodes, connections: [connection] }, geometryOptions);
  if (!geometry) throw new Error("expected connection geometry");
  expect(exported.svg).toContain(`d="${geometry.path}"`);
  expect(exported.svg).toContain("A &amp; B &lt;task&gt;");
  expect(exported.svg).toContain("<title>task</title>");
  expect(exported.unsupported).toEqual([]);
});

test("invalid export input throws and an explicit blank is not reported as unsupported", () => {
  expect(() => exportDrawSvg({ version: 1, nodes: [note] }, { scale: 0 })).toThrow(TypeError);
  expect(() => exportDrawPng(document, { crop: { x: 0, y: 0, width: 0, height: 10 } })).toThrow(TypeError);
  expect(() => exportDrawSvg({ version: 1, nodes: [{ ...note, bounds: { x: 0, y: 0, width: 0, height: 10 } }] })).toThrow(TypeError);
  expect(() => exportDrawSvg({ version: 1, nodes: [badge] }, { exportNode: () => [{ kind: "path", d: "S 1 2" }] })).toThrow(TypeError);
  const blank = exportDrawSvg({ version: 1, nodes: [note, widget] }, { exportNode: (node) => node.id === "note" ? [] : undefined });
  expect(blank.svg).not.toContain("Field note");
  expect(blank.svg).toContain("Live widget");
  expect(blank.unsupported).toEqual([]);
  const empty = exportDrawSvg({ version: 1, nodes: [] });
  expect(empty.width).toBe(1);
  expect(empty.height).toBe(1);
  expect(empty.unsupported).toEqual([]);
});

test("export follows committed document edits rather than a fixed camera", () => {
  const draw = createDrawController(document);
  const original = exportDrawSvg(draw.getSnapshot(), options).svg;
  expect(draw.commands.moveNode(note.id, { x: 10, y: 10 })).toBe(true);
  expect(exportDrawSvg(draw.getSnapshot(), options).svg).not.toBe(original);
  expect(draw.commands.undo()).toBe(true);
  expect(exportDrawSvg(draw.getSnapshot(), options).svg).toBe(original);
});
