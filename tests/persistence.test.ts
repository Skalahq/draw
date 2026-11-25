import { expect, test } from "bun:test";
import {
  createDrawController,
  createDrawPersistence,
  decodeDrawDocument,
  encodeDrawDocument,
  type DrawDocument,
  type DrawNode,
  type DrawPersistenceAdapter,
} from "@skalahq/draw/core";

const bounds = { x: 0, y: 0, width: 24, height: 16 };

function node(label: string, x = 0): DrawNode {
  return { id: label, type: "note", bounds: { ...bounds, x }, metadata: { label } };
}

function document(label: string, x = 0): DrawDocument {
  return { version: 1, nodes: [node(label, x)] };
}

function labelOf(snapshot: string): string {
  const value = decodeDrawDocument(snapshot).nodes[0]?.metadata?.label;
  return typeof value === "string" ? value : "";
}

test("saves are serialized per document and pending snapshots collapse to the latest", async () => {
  const hold = Promise.withResolvers<void>();
  const stored = new Map<string, string>();
  const calls: { id: string; label: string }[] = [];
  const active = new Map<string, number>();
  let releaseFirst = true;
  const adapter: DrawPersistenceAdapter = {
    async load(id) {
      return stored.get(id);
    },
    async save(id, snapshot) {
      const count = (active.get(id) ?? 0) + 1;
      active.set(id, count);
      expect(count).toBe(1);
      calls.push({ id, label: labelOf(snapshot) });
      if (id === "doc" && releaseFirst) {
        releaseFirst = false;
        await hold.promise;
      }
      active.set(id, (active.get(id) ?? 1) - 1);
      stored.set(id, snapshot);
    },
  };
  const persistence = createDrawPersistence(adapter);
  const states: string[] = [];
  persistence.subscribe("doc", (state) => states.push(state.status));

  persistence.save("doc", document("one"));
  persistence.save("doc", document("two"));
  persistence.save("doc", document("three"));
  persistence.save("other", document("side"));
  expect(persistence.getState("doc").status).toBe("saving");
  expect(calls.map(({ label }) => label)).toEqual(["one", "side"]);

  await persistence.flush("other");
  expect(persistence.getState("other").status).toBe("saved");
  expect(calls.some((call) => call.id === "doc" && call.label === "three")).toBe(false);

  hold.resolve();
  await persistence.flush("doc");
  expect(calls.filter((call) => call.id === "doc").map(({ label }) => label)).toEqual(["one", "three"]);
  expect(persistence.getState("doc")).toEqual({ status: "saved", documentId: "doc" });
  expect(states).toEqual(["saving", "saved"]);
  expect(encodeDrawDocument(await persistence.load("doc") as DrawDocument)).toBe(encodeDrawDocument(document("three")));
});

test("a delayed or failed save keeps the newest edits and retry writes that snapshot", async () => {
  const hold = Promise.withResolvers<void>();
  let fail = true;
  const calls: string[] = [];
  const persistence = createDrawPersistence({
    async load(id) {
      return id === "doc" ? calls.at(-1) : undefined;
    },
    async save(_id, snapshot) {
      calls.push(snapshot);
      if (calls.length === 1) await hold.promise;
      if (fail) throw new Error("disk full");
    },
  });
  const controller = createDrawController();
  const unbind = persistence.bind(controller, "doc");
  controller.commands.insertNode(node("one"));
  controller.commands.insertNode(node("two"));
  expect(controller.getSnapshot().nodes.map((item) => item.id)).toEqual(["one", "two"]);
  expect(calls).toHaveLength(1);

  hold.resolve();
  await expect(persistence.flush("doc")).rejects.toThrow("disk full");
  expect(persistence.getState("doc").status).toBe("failed");
  expect(persistence.getState("doc").error).toEqual(expect.objectContaining({ message: "disk full" }));
  expect(controller.getSnapshot().nodes).toHaveLength(2);
  expect(controller.commands.undo()).toBe(true);
  expect(controller.getSnapshot().nodes.map((item) => item.id)).toEqual(["one"]);

  await expect(persistence.flush("doc")).rejects.toThrow("disk full");
  expect(calls).toHaveLength(1);
  fail = false;
  persistence.retry("doc");
  expect(persistence.getState("doc").status).toBe("saving");
  await persistence.flush("doc");

  expect(calls.map(labelOf)).toEqual(["one", "one"]);
  expect(decodeDrawDocument(calls[1]).nodes).toHaveLength(1);
  expect(persistence.getState("doc")).toEqual({ status: "saved", documentId: "doc" });
  expect(controller.getSnapshot().nodes).toHaveLength(1);
  unbind();
  controller.commands.insertNode(node("after"));
  await persistence.flush("doc");
  expect(calls).toHaveLength(2);

  const reopened = createDrawController(await persistence.load("doc"));
  expect(reopened.commands.undo()).toBe(false);
  expect(reopened.commands.redo()).toBe(false);
  expect(reopened.getSnapshot().nodes.map((item) => item.id)).toEqual(["one"]);
});

test("binding ignores the open snapshot, and a failed attempt retains a later explicit save for retry", async () => {
  const calls: string[] = [];
  const stored = new Map<string, string>();
  let fail = true;
  const persistence = createDrawPersistence({
    async load(id) {
      return stored.get(id);
    },
    async save(id, snapshot) {
      calls.push(snapshot);
      if (id === "doc" && fail) throw new Error("offline");
      stored.set(id, snapshot);
    },
  });
  const open = createDrawController(document("kept"));
  persistence.bind(open, "doc");
  await persistence.flush("doc");
  expect(calls).toEqual([]);
  expect(open.commands.moveNode("kept", { x: 8, y: 0 })).toBe(true);

  persistence.save("other", document("elsewhere"));
  await expect(persistence.flush("doc")).rejects.toThrow("offline");
  expect(persistence.getState("other").status).toBe("saved");
  expect(() => persistence.save("", document("nope"))).toThrow(/document id/);
  await expect(persistence.load("bad")).resolves.toBeUndefined();

  persistence.save("doc", document("latest", 12));
  expect(calls.map(labelOf)).toEqual(["kept", "elsewhere"]);
  fail = false;
  persistence.retry("doc");
  await persistence.flush("doc");
  expect(calls.map(labelOf)).toEqual(["kept", "elsewhere", "latest"]);
  expect(JSON.parse(calls[2])).toEqual({ version: 1, nodes: [node("latest", 12)] });
  expect(Object.keys(JSON.parse(calls[2])).sort()).toEqual(["nodes", "version"]);
});

test("load decodes snapshot bytes and leaves an open canvas untouched when storage is invalid", async () => {
  const open = createDrawController(document("open"));
  open.commands.moveNode("open", { x: 3, y: 0 });
  const before = open.getSnapshot();
  const stored = new Map<string, string>([
    ["ok", encodeDrawDocument(document("stored"))],
    ["bad", "{\"version\":2,\"nodes\":[]}"],
  ]);
  const persistence = createDrawPersistence({
    async load(id) {
      return stored.get(id);
    },
    async save(id, snapshot) {
      stored.set(id, snapshot);
    },
  });

  expect(await persistence.load("missing")).toBeUndefined();
  expect(encodeDrawDocument(await persistence.load("ok") as DrawDocument)).toBe(encodeDrawDocument(document("stored")));
  await expect(persistence.load("bad")).rejects.toThrow(/Unsupported Draw document version: 2/);
  expect(open.getSnapshot()).toBe(before);
  expect(open.commands.undo()).toBe(true);
});
