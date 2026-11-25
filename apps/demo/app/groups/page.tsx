"use client";

import { createDrawController, selectTool, strokeNodeType, type DrawController, type DrawNode, type Size } from "@skalahq/draw/core";
import { DrawCanvas } from "@skalahq/draw/react";
import { Button } from "@ui-sdk/react/button";
import { memo, useCallback, useEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react";

const card = {
  id: "card",
  type: "card",
  bounds: { x: 40, y: 80, width: 160, height: 80 },
  metadata: { label: "Card" },
} satisfies DrawNode;
const ink = {
  id: "ink",
  type: strokeNodeType,
  bounds: { x: 360, y: 96, width: 48, height: 48 },
  metadata: { points: [{ x: 8, y: 24 }, { x: 40, y: 24 }] },
} satisfies DrawNode;
const nearby = {
  id: "nearby",
  type: "note",
  bounds: { x: 40, y: 220, width: 80, height: 40 },
  metadata: { label: "Nearby" },
} satisfies DrawNode;
const initial = {
  version: 1 as const,
  nodes: [card, ink, nearby],
  connections: [{ id: "link", source: { nodeId: "card", portId: "out" }, target: { nodeId: "ink" }, metadata: { kind: "flow" } }],
};

function nodeLabel(node: DrawNode): string {
  if (node.type === strokeNodeType) return "Freehand stroke";
  const label = node.metadata?.label;
  return typeof label === "string" ? label : node.type;
}

function renderNode(node: DrawNode) {
  return <div className="editor-node" data-kind={node.type}>{nodeLabel(node)}</div>;
}

function Card({ node }: { node: DrawNode; resize: (size: Size) => boolean }) {
  return <div className="editor-node" data-kind="card">{nodeLabel(node)}</div>;
}

const nodeRenderers = { card: { render: Card } };

const StableCanvas = memo(function StableCanvas({ controller, canvas, onSelectionChange }: {
  controller: DrawController;
  canvas: RefObject<HTMLDivElement | null>;
  onSelectionChange: (ids: readonly string[]) => void;
}) {
  return (
    <DrawCanvas
      ref={canvas}
      className="editor-canvas"
      aria-label="Drawing canvas"
      aria-describedby="groups-keys"
      controller={controller}
      tool={selectTool}
      onSelectionChange={onSelectionChange}
      renderNode={renderNode}
      nodeRenderers={nodeRenderers}
      getNodeLabel={nodeLabel}
    />
  );
});

export default function GroupsPage() {
  const [controller] = useState(() => createDrawController(initial));
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [commits, setCommits] = useState(0);
  const [ready, setReady] = useState(false);
  const canvas = useRef<HTMLDivElement>(null);
  const document = useSyncExternalStore(controller.subscribeCommitted, controller.getSnapshot, controller.getSnapshot);
  const onSelectionChange = useCallback((ids: readonly string[]) => setSelected(ids), []);

  useEffect(() => {
    setReady(true);
    return controller.subscribeCommitted(() => setCommits((count) => count + 1));
  }, [controller]);

  const nodeIds = new Set(document.nodes.map((node) => node.id));
  const groupIds = new Set(document.groups?.map((group) => group.id));
  const members = selected.filter((id) => nodeIds.has(id) || groupIds.has(id));
  const selectedGroup = [...selected].reverse().find((id) => groupIds.has(id));
  const sharedParent = members.length
    ? document.groups?.find((group) => members.every((id) => group.memberIds.includes(id)))
    : undefined;

  function groupSelection() {
    if (members.length < 2) return;
    controller.commands.group(members);
    canvas.current?.focus();
  }

  function ungroupSelection() {
    const target = selectedGroup ?? sharedParent?.id;
    if (!target) return;
    controller.commands.ungroup(target);
    canvas.current?.focus();
  }

  return (
    <main className="editor">
      <header className="editor-header">
        <h1>Grouped canvas</h1>
        <div className="editor-actions" aria-label="Document actions" role="group">
          <Button disabled={!ready} onClick={() => controller.commands.undo()}>Undo</Button>
          <Button disabled={!ready} onClick={() => controller.commands.redo()}>Redo</Button>
        </div>
      </header>
      <div className="editor-tools" aria-label="Canvas tools" role="group">
        <Button disabled={!ready || members.length < 2} onClick={groupSelection}>Group</Button>
        <Button disabled={!ready || (!selectedGroup && !sharedParent)} onClick={ungroupSelection}>Ungroup</Button>
      </div>
      <StableCanvas controller={controller} canvas={canvas} onSelectionChange={onSelectionChange} />
      <footer className="editor-footer">
        <p id="groups-keys">Shift-click adds to the selection. g groups nodes and groups. Shift+g ungroups the selected group, or the shared parent of the selected members. Arrows move a group without scaling it. Delete removes a group, its members, and their connections.</p>
        <p>Committed edits: <output aria-label="Committed edits">{commits}</output></p>
        <p>Selection: <output aria-label="Selection">{selected.join(",")}</output></p>
        <p>Groups: <output aria-label="Groups">{document.groups?.map((group) => `${group.id}:${group.memberIds.join("+")}`).join(" ") ?? ""}</output></p>
        <p>Positions: <output aria-label="Node positions">{document.nodes.map((node) => `${node.id}:${node.bounds.x},${node.bounds.y},${node.bounds.width},${node.bounds.height}`).join(" ")}</output></p>
        <p>Connections: <output aria-label="Connections">{document.connections?.map((edge) => `${edge.id}:${edge.source.nodeId}${edge.source.portId ? `.${edge.source.portId}` : ""}>${edge.target.nodeId}`).join(" ") ?? ""}</output></p>
      </footer>
    </main>
  );
}
