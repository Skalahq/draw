import { expect, test } from "bun:test";
import {
  createDrawController, decodeDrawDocument, encodeDrawDocument, getGroupBounds, parentGroupId,
  type DrawConnection, type DrawNode,
} from "@skalahq/draw/core";

const card = { id: "card", type: "card", bounds: { x: 40, y: 80, width: 160, height: 80 }, metadata: { label: "Card" } } satisfies DrawNode;
const ink = {
  id: "ink",
  type: "draw:stroke",
  bounds: { x: 360, y: 96, width: 48, height: 48 },
  metadata: { points: [{ x: 8, y: 24 }, { x: 40, y: 24 }] },
} satisfies DrawNode;
const nearby = { id: "nearby", type: "note", bounds: { x: 48, y: 148, width: 80, height: 40 }, metadata: { label: "Nearby" } } satisfies DrawNode;
const link = { id: "link", source: { nodeId: "card", portId: "out" }, target: { nodeId: "ink" }, metadata: { kind: "flow" } } satisfies DrawConnection;

function drawing() {
  return createDrawController({ version: 1, nodes: [card, ink, nearby], connections: [link] });
}

test("grouping is explicit, nested, and independent of overlap", () => {
  const draw = drawing();
  expect(draw.commands.group(["card"])).toBe(false);
  expect(draw.commands.group(["card", "link"])).toBe(false);
  expect(draw.commands.group(["card", "missing"])).toBe(false);
  expect(draw.commands.group(["card", "card"])).toBe(false);
  expect(draw.getSnapshot().groups).toBeUndefined();

  expect(draw.commands.group(["card", "ink"])).toBe(true);
  const grouped = draw.getSnapshot();
  expect(grouped.groups).toEqual([{ id: "group-1", memberIds: ["card", "ink"] }]);
  expect(parentGroupId(grouped, "card")).toBe("group-1");
  expect(parentGroupId(grouped, "nearby")).toBeUndefined();
  expect(grouped.nodes.map((node) => node.bounds)).toEqual([card.bounds, ink.bounds, nearby.bounds]);
  expect(grouped.connections).toEqual([link]);

  expect(draw.commands.group(["group-1", "nearby"])).toBe(true);
  expect(draw.getSnapshot().groups).toEqual([
    { id: "group-1", memberIds: ["card", "ink"] },
    { id: "group-2", memberIds: ["group-1", "nearby"] },
  ]);
  expect(draw.commands.group(["card", "nearby"])).toBe(false);
  expect(draw.commands.group(["group-2", "group-1"])).toBe(false);
  expect(draw.getSnapshot().groups?.map((group) => group.id)).toEqual(["group-1", "group-2"]);
});

test("moving a group translates descendants without scaling or reparenting", () => {
  const draw = drawing();
  draw.commands.group(["card", "ink"]);
  draw.commands.group(["group-1", "nearby"]);
  const before = draw.getSnapshot();

  expect(draw.commands.moveNode("group-2", { x: 50, y: 90 })).toBe(true);
  const moved = draw.getSnapshot();
  expect(moved.nodes.find((node) => node.id === "card")?.bounds).toEqual({ x: 50, y: 90, width: 160, height: 80 });
  expect(moved.nodes.find((node) => node.id === "ink")?.bounds).toEqual({ x: 370, y: 106, width: 48, height: 48 });
  expect(moved.nodes.find((node) => node.id === "nearby")?.bounds).toEqual({ x: 58, y: 158, width: 80, height: 40 });
  expect(moved.nodes.find((node) => node.id === "ink")?.metadata).toEqual(ink.metadata);
  expect(moved.connections).toBe(before.connections);
  expect(moved.groups).toBe(before.groups);
  expect(getGroupBounds(moved, "group-2")).toEqual({ x: 50, y: 90, width: 368, height: 108 });
  expect(draw.commands.moveNode("group-2", { x: 50, y: 90 })).toBe(false);
  expect(draw.commands.resizeNode("group-2", { width: 20, height: 20 })).toBe(false);

  expect(draw.commands.moveNode("card", { x: 80, y: 90 })).toBe(true);
  const edited = draw.getSnapshot();
  expect(parentGroupId(edited, "card")).toBe("group-1");
  expect(edited.nodes.find((node) => node.id === "ink")?.bounds.x).toBe(370);
  expect(edited.groups).toEqual(moved.groups);
});

test("ungroup preserves world positions and connection attachments", () => {
  const draw = drawing();
  draw.commands.group(["card", "ink"]);
  draw.commands.group(["group-1", "nearby"]);
  draw.commands.moveNode("group-2", { x: 50, y: 90 });
  const moved = draw.getSnapshot();

  expect(draw.commands.ungroup("missing")).toBe(false);
  expect(draw.commands.ungroup("group-2")).toBe(true);
  const outer = draw.getSnapshot();
  expect(outer.groups).toEqual([{ id: "group-1", memberIds: ["card", "ink"] }]);
  expect(outer.nodes).toEqual(moved.nodes);
  expect(outer.connections).toEqual(moved.connections);
  expect(parentGroupId(outer, "nearby")).toBeUndefined();

  expect(draw.commands.ungroup("group-1")).toBe(true);
  const flat = draw.getSnapshot();
  expect(flat.groups).toBeUndefined();
  expect(flat.nodes).toEqual(moved.nodes);
  expect(flat.connections).toEqual([link]);
  expect(encodeDrawDocument(flat)).toBe(encodeDrawDocument({ version: 1, nodes: moved.nodes, connections: [link] }));
});

test("deleting a group removes descendants and incident connections in one edit", () => {
  const draw = drawing();
  draw.commands.group(["card", "ink"]);
  draw.commands.group(["group-1", "nearby"]);
  draw.commands.moveNode("group-2", { x: 12, y: 20 });
  const beforeDelete = draw.getSnapshot();

  expect(draw.commands.deleteNode("group-1")).toBe(true);
  const deleted = draw.getSnapshot();
  expect(deleted.nodes.map((node) => node.id)).toEqual(["nearby"]);
  expect(deleted.connections).toEqual([]);
  expect(deleted.groups).toEqual([{ id: "group-2", memberIds: ["nearby"] }]);
  expect(draw.commands.undo()).toBe(true);
  expect(draw.getSnapshot()).toEqual(beforeDelete);

  expect(draw.commands.deleteNode("group-2")).toBe(true);
  expect(draw.getSnapshot()).toEqual({ version: 1, nodes: [], connections: [] });
  expect(draw.commands.undo()).toBe(true);
  expect(draw.getSnapshot()).toEqual(beforeDelete);
  expect(draw.commands.redo()).toBe(true);
  expect(draw.getSnapshot().nodes).toEqual([]);
});

test("editable JSON round-trips nested groups and rejects invalid membership", () => {
  const draw = drawing();
  draw.commands.group(["card", "ink"]);
  draw.commands.group(["group-1", "nearby"]);
  const json = encodeDrawDocument(draw.getSnapshot());
  expect(JSON.parse(json).groups).toEqual([
    { id: "group-1", memberIds: ["card", "ink"] },
    { id: "group-2", memberIds: ["group-1", "nearby"] },
  ]);
  const reopened = createDrawController(decodeDrawDocument(json));
  expect(encodeDrawDocument(reopened.getSnapshot())).toBe(json);
  expect(reopened.commands.undo()).toBe(false);

  const base = { version: 1, nodes: [card, ink], connections: [link] };
  expect(() => decodeDrawDocument(JSON.stringify({ ...base, groups: { id: "group-1" } }))).toThrow(/groups array/);
  expect(() => decodeDrawDocument(JSON.stringify({ ...base, groups: [{ id: "card", memberIds: ["ink"] }] }))).toThrow(/unique group id/);
  expect(() => decodeDrawDocument(JSON.stringify({ ...base, groups: [{ id: "group-1", memberIds: [] }] }))).toThrow(/memberIds/);
  expect(() => decodeDrawDocument(JSON.stringify({ ...base, groups: [{ id: "group-1", memberIds: ["link"] }] }))).toThrow(/memberIds/);
  expect(() => decodeDrawDocument(JSON.stringify({
    ...base,
    groups: [{ id: "group-1", memberIds: ["group-2"] }, { id: "group-2", memberIds: ["group-1"] }],
  }))).toThrow(/cyclic/);
  expect(draw.getSnapshot().groups).toHaveLength(2);
});
