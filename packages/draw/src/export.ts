import type { Bounds, DrawDocument, DrawNode } from "./core.js";
import type { ConnectionGeometryOptions } from "./connections.js";
import { connectionArrowheadTransform, defaultArrowheadPath, getConnectionGeometry } from "./connections.js";
import { textGlyphs, type GlyphRect } from "./export-font.js";
import { pathBounds } from "./export-path.js";
import { rasterizeScene, type PaintMark } from "./export-png.js";
import { getStrokeGeometry, strokeNodeType, strokeWidth } from "./stroke.js";

const ink = "#203a42";
const paper = "#ffffff";
const labelSize = 14;
const labelInset = 8;
const connectionStrokeWidth = 2;

export type DrawExportUnsupported = Readonly<{ id: string; type: string }>;

export type DrawExportMark = Readonly<
  | {
    kind: "rect";
    x: number;
    y: number;
    width: number;
    height: number;
    fill?: string;
    stroke?: string;
    strokeWidth?: number;
  }
  | {
    kind: "path";
    d: string;
    fill?: string;
    stroke?: string;
    strokeWidth?: number;
    lineCap?: "butt" | "round" | "square";
    lineJoin?: "miter" | "round" | "bevel";
  }
  | { kind: "text"; x: number; y: number; text: string; fontSize?: number; fill?: string }
>;

/** Node-local marks, or `"unsupported"` when the node must be reported instead of drawn. */
export type DrawNodeExport = readonly DrawExportMark[] | "unsupported";

export type DrawExportOptions = ConnectionGeometryOptions & {
  /** Document-space crop. Defaults to the bounds of exportable ink, independent of pan and zoom. */
  crop?: Bounds;
  /** PNG pixel multiplier. Does not change SVG user units. Defaults to 1. */
  scale?: number;
  getNodeLabel?: (node: DrawNode) => string;
  /**
   * Custom visual export. Return undefined for the built-in stroke or labeled rectangle.
   * Return `"unsupported"` to report the node instead of omitting it.
   * Mark coordinates are node-local: (0, 0) is the node's top-left.
   */
  exportNode?: (node: DrawNode) => DrawNodeExport | undefined;
};

export type DrawSvgExport = Readonly<{
  svg: string;
  width: number;
  height: number;
  unsupported: readonly DrawExportUnsupported[];
}>;

export type DrawPngExport = Readonly<{
  png: Uint8Array;
  width: number;
  height: number;
  unsupported: readonly DrawExportUnsupported[];
}>;

type Box = { minX: number; minY: number; maxX: number; maxY: number };
type SceneGroup = { title?: string; marks: PaintMark[] };
type Scene = {
  frame: Bounds;
  groups: SceneGroup[];
  marks: PaintMark[];
  unsupported: DrawExportUnsupported[];
};

function snap(value: number): number {
  const rounded = Math.round(value * 1e6) / 1e6;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function finite(value: number): boolean {
  return Number.isFinite(value);
}

function assertDocument(document: DrawDocument) {
  if (document?.version !== 1 || !Array.isArray(document.nodes)
    || (document.connections !== undefined && !Array.isArray(document.connections))) {
    throw new TypeError("Invalid Draw document");
  }
}

function assertScale(scale: number | undefined) {
  if (scale !== undefined && (!finite(scale) || scale <= 0)) throw new TypeError("Invalid PNG scale");
}

function assertCrop(crop: Bounds) {
  if (!finite(crop.x) || !finite(crop.y) || !finite(crop.width) || !finite(crop.height) || crop.width <= 0 || crop.height <= 0) {
    throw new TypeError("Invalid export crop");
  }
}

function assertBounds(bounds: Bounds, id: string) {
  if (!finite(bounds.x) || !finite(bounds.y) || !finite(bounds.width) || !finite(bounds.height) || bounds.width <= 0 || bounds.height <= 0) {
    throw new TypeError(`Invalid bounds for node ${id}`);
  }
}

function assertColor(color: string | undefined, id: string) {
  if (color !== undefined && color !== "none" && !/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(color)) {
    throw new TypeError(`Invalid export color for node ${id}`);
  }
}

function nodeLabel(node: DrawNode, getNodeLabel: DrawExportOptions["getNodeLabel"]): string {
  if (getNodeLabel) return getNodeLabel(node);
  const label = node.metadata?.label;
  return typeof label === "string" ? label : node.type;
}

function readMarks(node: DrawNode, value: readonly DrawExportMark[]): readonly DrawExportMark[] {
  if (!Array.isArray(value)) throw new TypeError(`Invalid export representation for node ${node.id}`);
  for (const mark of value) {
    if (mark?.kind === "rect") {
      if (!finite(mark.x) || !finite(mark.y) || !finite(mark.width) || !finite(mark.height) || mark.width <= 0 || mark.height <= 0) {
        throw new TypeError(`Invalid export representation for node ${node.id}`);
      }
    } else if (mark?.kind === "path") {
      if (typeof mark.d !== "string" || !mark.d) throw new TypeError(`Invalid export representation for node ${node.id}`);
      pathBounds(mark.d, undefined, 0);
      if (mark.lineCap && mark.lineCap !== "butt" && mark.lineCap !== "round" && mark.lineCap !== "square") {
        throw new TypeError(`Invalid export representation for node ${node.id}`);
      }
      if (mark.lineJoin && mark.lineJoin !== "miter" && mark.lineJoin !== "round" && mark.lineJoin !== "bevel") {
        throw new TypeError(`Invalid export representation for node ${node.id}`);
      }
    } else if (mark?.kind === "text") {
      if (typeof mark.text !== "string" || !finite(mark.x) || !finite(mark.y) || (mark.fontSize !== undefined && (!finite(mark.fontSize) || mark.fontSize <= 0))) {
        throw new TypeError(`Invalid export representation for node ${node.id}`);
      }
    } else {
      throw new TypeError(`Invalid export representation for node ${node.id}`);
    }
    assertColor(mark.fill, node.id);
    if (mark.kind !== "text") {
      assertColor(mark.stroke, node.id);
      if (mark.strokeWidth !== undefined && (!finite(mark.strokeWidth) || mark.strokeWidth <= 0)) {
        throw new TypeError(`Invalid export representation for node ${node.id}`);
      }
    }
  }
  return value;
}

function clipGlyph(glyph: GlyphRect, bounds: Bounds): GlyphRect | undefined {
  const x = Math.max(glyph.x, bounds.x);
  const y = Math.max(glyph.y, bounds.y);
  const right = Math.min(glyph.x + glyph.width, bounds.x + bounds.width);
  const bottom = Math.min(glyph.y + glyph.height, bounds.y + bounds.height);
  if (right <= x || bottom <= y) return;
  return { x, y, width: right - x, height: bottom - y };
}

function glyphMarks(text: string, x: number, y: number, fontSize: number, fill: string, clip?: Bounds): PaintMark[] {
  const marks: PaintMark[] = [];
  for (const glyph of textGlyphs(text, x, y, fontSize)) {
    const painted = clip ? clipGlyph(glyph, clip) : glyph;
    if (painted) marks.push({ kind: "rect", ...painted, fill });
  }
  return marks;
}

function labeledRectangle(node: DrawNode, label: string): PaintMark[] {
  const { x, y, width, height } = node.bounds;
  const frame: PaintMark = width > 1 && height > 1
    ? { kind: "rect", x: x + 0.5, y: y + 0.5, width: width - 1, height: height - 1, fill: paper, stroke: ink, strokeWidth: 1 }
    : { kind: "rect", x, y, width, height, fill: paper };
  return [frame, ...glyphMarks(label, x + labelInset, y + height / 2, labelSize, ink, node.bounds)];
}

function placeMark(node: DrawNode, mark: DrawExportMark): PaintMark[] {
  const origin = node.bounds;
  if (mark.kind === "rect") {
    return [{
      kind: "rect",
      x: origin.x + mark.x,
      y: origin.y + mark.y,
      width: mark.width,
      height: mark.height,
      fill: mark.fill,
      stroke: mark.stroke,
      strokeWidth: mark.strokeWidth,
    }];
  }
  if (mark.kind === "path") {
    return [{
      kind: "path",
      d: mark.d,
      fill: mark.fill ?? "none",
      stroke: mark.stroke,
      strokeWidth: mark.strokeWidth,
      lineCap: mark.lineCap,
      lineJoin: mark.lineJoin,
      transform: `translate(${snap(origin.x)} ${snap(origin.y)})`,
    }];
  }
  return glyphMarks(mark.text, origin.x + mark.x, origin.y + mark.y, mark.fontSize ?? labelSize, mark.fill ?? ink);
}

function markBounds(mark: PaintMark): Box | undefined {
  if (mark.kind === "rect") {
    const pad = mark.stroke && mark.stroke !== "none" ? (mark.strokeWidth ?? 1) / 2 : 0;
    return { minX: mark.x - pad, minY: mark.y - pad, maxX: mark.x + mark.width + pad, maxY: mark.y + mark.height + pad };
  }
  const pad = mark.stroke && mark.stroke !== "none" ? (mark.strokeWidth ?? 1) / 2 : 0;
  return pathBounds(mark.d, mark.transform, pad);
}

function union(box: Box | undefined, next: Box | undefined): Box | undefined {
  if (!next) return box;
  if (!box) return next;
  return {
    minX: Math.min(box.minX, next.minX),
    minY: Math.min(box.minY, next.minY),
    maxX: Math.max(box.maxX, next.maxX),
    maxY: Math.max(box.maxY, next.maxY),
  };
}
function intersects(mark: PaintMark, frame: Bounds): boolean {
  const box = markBounds(mark);
  if (!box) return false;
  return box.maxX > frame.x && box.minX < frame.x + frame.width && box.maxY > frame.y && box.minY < frame.y + frame.height;
}

function escapeXml(value: string): string {
  return value.replace(/[&<>"]/g, (char) => char === "&" ? "&amp;" : char === "<" ? "&lt;" : char === ">" ? "&gt;" : "&quot;");
}

function markSvg(mark: PaintMark): string {
  if (mark.kind === "rect") {
    const attrs = [
      `x="${snap(mark.x)}"`,
      `y="${snap(mark.y)}"`,
      `width="${snap(mark.width)}"`,
      `height="${snap(mark.height)}"`,
      `fill="${mark.fill ?? "none"}"`,
    ];
    if (mark.stroke && mark.stroke !== "none") attrs.push(`stroke="${mark.stroke}"`, `stroke-width="${snap(mark.strokeWidth ?? 1)}"`);
    return `<rect ${attrs.join(" ")}/>`;
  }
  const attrs = [`d="${mark.d}"`, `fill="${mark.fill ?? "none"}"`];
  if (mark.stroke && mark.stroke !== "none") {
    attrs.push(
      `stroke="${mark.stroke}"`,
      `stroke-width="${snap(mark.strokeWidth ?? 1)}"`,
      `stroke-linecap="${mark.lineCap ?? "butt"}"`,
      `stroke-linejoin="${mark.lineJoin ?? "round"}"`,
    );
  }
  if (mark.transform) attrs.push(`transform="${mark.transform}"`);
  return `<path ${attrs.join(" ")}/>`;
}

function sceneToSvg(scene: Scene): string {
  const { x, y, width, height } = scene.frame;
  const body = [`<rect x="${snap(x)}" y="${snap(y)}" width="${snap(width)}" height="${snap(height)}" fill="${paper}"/>`];
  for (const group of scene.groups) {
    const marks = group.marks.map(markSvg).join("");
    if (!marks && !group.title) continue;
    const title = group.title ? `<title>${escapeXml(group.title)}</title>` : "";
    body.push(`<g>${title}${marks}</g>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${snap(width)}" height="${snap(height)}" viewBox="${snap(x)} ${snap(y)} ${snap(width)} ${snap(height)}" overflow="hidden">${body.join("")}</svg>`;
}

function buildScene(document: DrawDocument, options?: DrawExportOptions): Scene {
  assertDocument(document);
  assertScale(options?.scale);
  if (options?.crop) assertCrop(options.crop);
  const nodes = new Map(document.nodes.map((node) => [node.id, node]));
  const unsupported: DrawExportUnsupported[] = [];
  const groups: SceneGroup[] = [];
  const connectionMarks: PaintMark[] = [];
  for (const connection of document.connections ?? []) {
    const geometry = getConnectionGeometry(connection, (id) => nodes.get(id), options);
    if (!geometry) continue;
    connectionMarks.push(
      {
        kind: "path",
        d: geometry.path,
        fill: "none",
        stroke: ink,
        strokeWidth: connectionStrokeWidth,
        lineCap: "butt",
        lineJoin: "round",
      },
      {
        kind: "path",
        d: defaultArrowheadPath,
        fill: ink,
        transform: connectionArrowheadTransform(geometry.arrowhead),
      },
    );
  }
  if (connectionMarks.length) groups.push({ marks: connectionMarks });

  for (const node of document.nodes) {
    assertBounds(node.bounds, node.id);
    const exported = options?.exportNode?.(node);
    if (exported === "unsupported") {
      unsupported.push({ id: node.id, type: node.type });
      continue;
    }
    const supplied = exported === undefined ? undefined : readMarks(node, exported);
    const label = nodeLabel(node, options?.getNodeLabel);
    const geometry = supplied ? undefined : node.type === strokeNodeType ? getStrokeGeometry(node) : undefined;
    let marks: PaintMark[];
    if (supplied) marks = supplied.flatMap((mark) => placeMark(node, mark));
    else if (geometry) {
      marks = [{
        kind: "path",
        d: geometry.d,
        fill: "none",
        stroke: ink,
        strokeWidth,
        lineCap: "round",
        lineJoin: "round",
        transform: `translate(${snap(node.bounds.x)} ${snap(node.bounds.y)})`,
      }];
    } else marks = labeledRectangle(node, label);
    if (!marks.length) continue;
    const titles = [label];
    if (supplied) {
      for (const mark of supplied) if (mark.kind === "text" && mark.text && mark.text !== label) titles.push(mark.text);
    }
    groups.push({ title: titles.filter(Boolean).join("\n"), marks });
  }

  let box: Box | undefined;
  const marks = groups.flatMap((group) => group.marks);
  for (const mark of marks) box = union(box, markBounds(mark));
  const rawFrame = options?.crop ?? (box
    ? { x: box.minX, y: box.minY, width: box.maxX - box.minX, height: box.maxY - box.minY }
    : { x: 0, y: 0, width: 1, height: 1 });
  const frame = { x: snap(rawFrame.x), y: snap(rawFrame.y), width: snap(rawFrame.width), height: snap(rawFrame.height) };
  if (frame.width <= 0 || frame.height <= 0) throw new TypeError("Invalid export crop");
  const visible = groups.flatMap((group) => {
    const painted = group.marks.filter((mark) => intersects(mark, frame));
    return painted.length ? [{ title: group.title, marks: painted }] : [];
  });
  return { frame, groups: visible, marks: visible.flatMap((group) => group.marks), unsupported };
}

/** Export the committed drawing as SVG. Session camera, selection, and previews are not inputs. */
export function exportDrawSvg(document: DrawDocument, options?: DrawExportOptions): DrawSvgExport {
  const scene = buildScene(document, options);
  return { svg: sceneToSvg(scene), width: scene.frame.width, height: scene.frame.height, unsupported: scene.unsupported };
}

/** Rasterize the same scene as `exportDrawSvg`. `scale` multiplies pixel dimensions. */
export function exportDrawPng(document: DrawDocument, options?: DrawExportOptions): DrawPngExport {
  const scene = buildScene(document, options);
  const raster = rasterizeScene(scene.frame, paper, scene.marks, options?.scale ?? 1);
  return { png: raster.png, width: raster.width, height: raster.height, unsupported: scene.unsupported };
}


