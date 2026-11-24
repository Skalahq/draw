import { expect, test } from "bun:test";
import { createDrawController, getConnectionGeometry, hitTestConnection, type DrawConnection, type DrawDocument } from "@skalahq/draw/core";

const nodes = [
  { id: "a", type: "first", bounds: { x: 0, y: 0, width: 100, height: 80 } },
  { id: "b", type: "unknown", bounds: { x: 300, y: 0, width: 100, height: 80 } },
  { id: "c", type: "third", bounds: { x: 600, y: 0, width: 100, height: 80 } },
];
const connection = {
  id: "edge", source: { nodeId: "a", portId: "out" }, target: { nodeId: "b" },
  metadata: { relation: ["depends", { priority: 2 }] },
} satisfies DrawConnection;

test("the original port returns after fallback; endpoints follow committed node movement", () => {
  const draw = createDrawController({ version: 1, nodes, connections: [connection] });
  const getNode = (id: string) => draw.getSnapshot().nodes.find((node) => node.id === id);
  const edge = draw.getSnapshot().connections![0];
  const ports = { getPorts: () => [{ id: "out", position: { x: 100, y: 40 } }] };
  expect(getConnectionGeometry(edge, getNode, ports)?.source).toEqual({ x: 100, y: 40 });
  draw.commands.moveNode("a", { x: 50, y: 0 });
  expect(getConnectionGeometry(edge, getNode, ports)?.source).toEqual({ x: 150, y: 40 });
  const restored = { getPorts: () => [{ id: "out", position: { x: 25, y: 40 } }] };
  expect(getConnectionGeometry(edge, getNode, restored)?.source).toEqual({ x: 75, y: 40 });
  expect(getConnectionGeometry(edge, getNode)?.source).toEqual({ x: 150, y: 40 });
  expect(draw.getSnapshot().connections![0].source.portId).toBe("out");
  expect(getConnectionGeometry(edge, getNode, restored)?.source).toEqual({ x: 75, y: 40 });
});

test("creation, reconnection at either end, and incident deletion share node history", () => {
  const draw = createDrawController({ version: 1, nodes });
  const received: DrawDocument[] = [];
  draw.subscribeCommitted((document) => received.push(document));
  expect(draw.commands.insertConnection(connection)).toBe(true);
  expect(draw.commands.insertConnection(connection)).toBe(false);
  expect(draw.commands.reconnectConnection("edge", "target", { nodeId: "absent" })).toBe(false);
  expect(draw.commands.reconnectConnection("edge", "target", { nodeId: "b" })).toBe(false);
  expect(draw.commands.reconnectConnection("edge", "target", { nodeId: "c", portId: "in" })).toBe(true);
  expect(draw.commands.reconnectConnection("edge", "source", { nodeId: "b" })).toBe(true);
  const reconnected = draw.getSnapshot().connections![0];
  expect(reconnected).toEqual({ ...connection, source: { nodeId: "b" }, target: { nodeId: "c", portId: "in" } });
  expect(received).toHaveLength(3);
  expect(draw.commands.deleteNode("b")).toBe(true);
  expect(received.at(-1)?.nodes.map(({ id }) => id)).toEqual(["a", "c"]);
  expect(received.at(-1)?.connections).toEqual([]);
  expect(received).toHaveLength(4);
  draw.commands.undo();
  expect(draw.getSnapshot().connections).toEqual([reconnected]);
  expect(draw.getSnapshot().nodes.map(({ id }) => id)).toEqual(["a", "b", "c"]);
  draw.commands.undo();
  expect(draw.getSnapshot().connections![0].source).toEqual(connection.source);
  draw.commands.undo();
  expect(draw.getSnapshot().connections).toEqual([connection]);
  draw.commands.redo();
  expect(draw.getSnapshot().connections![0].target).toEqual({ nodeId: "c", portId: "in" });
});

test("custom curve hit testing follows the visible path and arrowhead tangent", () => {
  const geometry = getConnectionGeometry(connection, (id) => nodes.find((node) => node.id === id), {
    getConnectionPath: (_edge, { target }) => [{ to: target, control: { x: 300, y: -160 } }],
  })!;
  expect(geometry.arrowhead.position).toEqual({ x: 300, y: 40 });
  expect(geometry.arrowhead.direction).toEqual({ x: 0, y: 1 });
  expect(hitTestConnection(geometry, { x: 250, y: -60 }, 4)).toBe(true);
  expect(hitTestConnection(geometry, { x: 250, y: 40 }, 4)).toBe(false);
});

test("opening serialized version-1 snapshots preserves unattached ports, metadata, and unknown node types", () => {
  const saved = createDrawController({ version: 1, nodes, connections: [connection] });
  const reopened = createDrawController(JSON.parse(JSON.stringify(saved.getSnapshot())));
  expect(reopened.getSnapshot().connections).toEqual([connection]);
  expect(reopened.getSnapshot().nodes[1].type).toBe("unknown");
  expect(reopened.commands.undo()).toBe(false);
  expect(() => createDrawController({ version: 1, nodes, connections: [connection, connection] })).toThrow("Invalid connection in Draw snapshot");
  expect(() => createDrawController({ version: 1, nodes: nodes.slice(1), connections: [connection] })).toThrow("Invalid connection in Draw snapshot");
});
