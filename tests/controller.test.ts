import { expect, test } from "bun:test";
import { createDrawController, type DrawDocument } from "@skalahq/draw/core";

const note = { id: "note", type: "note", bounds: { x: 0, y: 0, width: 120, height: 64 }, metadata: { title: "First note" } };

test("host commands, undo, and redo publish only committed snapshots", () => {
  const draw = createDrawController();
  const received: DrawDocument[] = [];
  const unsubscribe = draw.subscribeCommitted((document) => received.push(document));

  draw.commands.insertNode(note);
  draw.commands.moveNode("note", { x: 24, y: -12 });
  draw.commands.moveNode("note", { x: 24, y: -12 });
  draw.commands.resizeNode("note", { width: 140, height: 80 });
  draw.commands.deleteNode("note");
  draw.commands.undo();
  draw.commands.undo();
  draw.commands.redo();
  unsubscribe();
  draw.commands.undo();

  expect(received.map(({ nodes }) => nodes.at(0)?.bounds)).toEqual([
    note.bounds,
    { x: 24, y: -12, width: 120, height: 64 },
    { x: 24, y: -12, width: 140, height: 80 },
    undefined,
    { x: 24, y: -12, width: 140, height: 80 },
    { x: 24, y: -12, width: 120, height: 64 },
    { x: 24, y: -12, width: 140, height: 80 },
  ]);
  expect(draw.getSnapshot().nodes[0]?.metadata).toEqual({ title: "First note" });
});

test("a subscriber can issue a command without other subscribers seeing commits out of order", () => {
  const draw = createDrawController();
  const positions: number[] = [];

  draw.subscribeCommitted(({ nodes }) => {
    if (nodes[0]?.bounds.x === 0) draw.commands.moveNode("note", { x: 24, y: 0 });
  });
  draw.subscribeCommitted(({ nodes }) => positions.push(nodes[0].bounds.x));

  draw.commands.insertNode(note);
  expect(positions).toEqual([0, 24]);
});

test("opening a document rejects ambiguous node IDs", () => {
  expect(() => createDrawController({ version: 1, nodes: [note, note] })).toThrow("Invalid node in Draw snapshot");
});
