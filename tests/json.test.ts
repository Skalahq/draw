import { expect, test } from "bun:test";
import { createDrawController, decodeDrawDocument, encodeDrawDocument, type DrawNode } from "@skalahq/draw/core";

const bounds = { x: -12.5, y: 24, width: 144, height: 80 };
const unregistered = {
  id: "host-01",
  type: "vendor:unregistered",
  bounds,
  metadata: { label: "Research", options: [true, null, { title: "豊かさ", "a.b": 3 }] },
} satisfies DrawNode;
const stroke = {
  id: "stroke-01",
  type: "draw:stroke",
  bounds: { x: 20, y: 40, width: 12, height: 8 },
  metadata: { points: [{ x: 0, y: 0 }, { x: 12, y: 8 }] },
} satisfies DrawNode;

test("editable JSON preserves stacking and opaque data and opens with fresh history", () => {
  const source = createDrawController();
  source.commands.insertNode(unregistered);
  source.commands.insertNode(stroke);
  source.commands.moveNode(stroke.id, { x: 88, y: 60 });
  source.commands.undo();

  const json = encodeDrawDocument(source.getSnapshot());
  expect(JSON.parse(json)).toEqual({ version: 1, nodes: [unregistered, stroke] });

  const reopened = createDrawController(decodeDrawDocument(json));
  expect(reopened.commands.undo()).toBe(false);
  expect(reopened.commands.redo()).toBe(false);
  expect(encodeDrawDocument(reopened.getSnapshot())).toBe(json);
  expect(reopened.commands.moveNode(unregistered.id, { x: 10, y: 20 })).toBe(true);
  expect(reopened.commands.undo()).toBe(true);
  expect(encodeDrawDocument(reopened.getSnapshot())).toBe(json);
});

test("the versioned format owns only document fields and does not interpret metadata keys", () => {
  const snapshot = decodeDrawDocument(`{
    "nodes": [{"id":"host-01","type":"vendor:unregistered","bounds":{"height":80,"width":144,"y":24,"x":-12.5},
      "metadata":{"__proto__":{"owner":"host"},"selection":["keep"]}, "selected":true}],
    "version":1, "camera":{"zoom":2}, "selection":["host-01"], "history":[], "tool":"pan", "gesture":{}
  }`);
  const json = '{"version":1,"nodes":[{"id":"host-01","type":"vendor:unregistered","bounds":{"x":-12.5,"y":24,"width":144,"height":80},"metadata":{"__proto__":{"owner":"host"},"selection":["keep"]}}]}';
  expect(encodeDrawDocument(snapshot)).toBe(json);
  expect(encodeDrawDocument(decodeDrawDocument(json))).toBe(json);
});

test.each([
  ["malformed JSON", "{", /Invalid Draw JSON/],
  ["non-object document", "[]", /Draw document/],
  ["missing version", '{"nodes":[]}', /version/i],
  ["unsupported version", '{"version":2,"nodes":[]}', /Unsupported Draw document version/],
  ["non-array nodes", '{"version":1,"nodes":{}}', /nodes/],
  ["duplicate IDs", JSON.stringify({ version: 1, nodes: [unregistered, unregistered] }), /nodes\[1\]/],
  ["non-string ID", JSON.stringify({ version: 1, nodes: [{ ...unregistered, id: 42 }] }), /nodes\[0\]/],
  ["empty type", JSON.stringify({ version: 1, nodes: [{ ...unregistered, type: "" }] }), /nodes\[0\]/],
  ["non-object bounds", JSON.stringify({ version: 1, nodes: [{ ...unregistered, bounds: null }] }), /bounds/],
  ["zero width", JSON.stringify({ version: 1, nodes: [{ ...unregistered, bounds: { ...bounds, width: 0 } }] }), /bounds/],
  ["non-finite coordinates", '{"version":1,"nodes":[{"id":"a","type":"note","bounds":{"x":1e400,"y":0,"width":2,"height":2}}]}', /bounds/],
  ["non-object metadata", JSON.stringify({ version: 1, nodes: [{ ...unregistered, metadata: [] }] }), /metadata/],
  ["non-finite metadata", '{"version":1,"nodes":[{"id":"a","type":"note","bounds":{"x":0,"y":0,"width":2,"height":2},"metadata":{"values":[1e400]}}]}', /metadata/],
] as const)("rejects %s before creating a replacement controller", (_, input, message) => {
  const open = createDrawController();
  open.commands.insertNode(unregistered);
  const before = open.getSnapshot();

  expect(() => { createDrawController(decodeDrawDocument(input)); }).toThrow(message);
  expect(open.getSnapshot()).toBe(before);
  expect(open.commands.undo()).toBe(true);
});

test("export refuses to silently convert invalid metadata", () => {
  const node = { ...unregistered, metadata: { amount: Infinity } };
  const open = createDrawController({ version: 1, nodes: [node] });
  expect(() => encodeDrawDocument(open.getSnapshot())).toThrow(/metadata/);
});
