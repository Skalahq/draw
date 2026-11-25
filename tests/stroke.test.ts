import { expect, test } from "bun:test";
import { createDrawController, getStrokeGeometry, strokeNodeType, type DrawNode } from "@skalahq/draw/core";

const stroke: DrawNode = {
  id: "ink",
  type: strokeNodeType,
  bounds: { x: -12, y: 30, width: 24, height: 12 },
  metadata: { points: [{ x: 2, y: 2 }, { x: 10, y: 10 }, { x: 22, y: 2 }] },
};

test("moving a stroke translates its bounds without changing its node-local geometry", () => {
  const draw = createDrawController();
  expect(draw.commands.insertNode(stroke)).toBe(true);
  const original = draw.getSnapshot().nodes[0];
  const geometry = getStrokeGeometry(original);
  expect(geometry).toEqual({ bounds: stroke.bounds, d: "M2 2L10 10L22 2" });
  if (!geometry) throw new Error("expected stroke geometry");

  expect(draw.commands.moveNode(stroke.id, { x: 40, y: -15 })).toBe(true);
  const moved = draw.getSnapshot().nodes[0];
  expect(moved.metadata).toEqual(original.metadata);
  expect(getStrokeGeometry(moved)).toEqual({ bounds: { x: 40, y: -15, width: 24, height: 12 }, d: geometry.d });
  expect(draw.commands.resizeNode(stroke.id, { width: 10, height: 10 })).toBe(false);
  expect(draw.commands.undo()).toBe(true);
  expect(draw.getSnapshot().nodes).toEqual([original]);
});

test("a single sample renders as a round dot and stroke validation does not constrain host metadata", () => {
  const dot = { ...stroke, bounds: { x: 10, y: 5, width: 4, height: 4 }, metadata: { points: [{ x: 2, y: 2 }] } };
  expect(getStrokeGeometry(dot)).toEqual({ bounds: dot.bounds, d: "M2 2L2 2" });

  const invalid = { ...stroke, metadata: { points: [] } };
  const draw = createDrawController();
  expect(draw.commands.insertNode(invalid)).toBe(false);
  expect(() => createDrawController({ version: 1, nodes: [invalid] })).toThrow(TypeError);
  expect(getStrokeGeometry(invalid)).toBeUndefined();
  expect(draw.commands.insertNode({ ...invalid, type: "host:note" })).toBe(true);
});
