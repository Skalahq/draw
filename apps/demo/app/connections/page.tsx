"use client";

import {
  connectTool, connectionArrowheadTransform, createDrawController, defaultArrowheadPath, selectTool,
  type CanvasTool, type DrawNode, type DrawPort,
} from "@skalahq/draw/core";
import { DrawCanvas } from "@skalahq/draw/react";
import { Button } from "@ui-sdk/react/button";
import { Toggle } from "@ui-sdk/react/toggle";
import { useEffect, useRef, useState } from "react";

const nodes: DrawNode[] = [
  { id: "start", type: "task", bounds: { x: 56, y: 160, width: 144, height: 80 }, metadata: { label: "Start" } },
  { id: "middle", type: "task", bounds: { x: 400, y: 160, width: 200, height: 80 }, metadata: { label: "Middle" } },
  { id: "end", type: "task", bounds: { x: 400, y: 390, width: 200, height: 80 }, metadata: { label: "End" } },
];

const nodePorts: Readonly<Record<string, readonly DrawPort[]>> = {
  start: [{ id: "out", position: { x: 144, y: 28 }, label: "out" }],
  middle: [{ id: "in", position: { x: 0, y: 28 }, label: "in" }],
  end: [{ id: "in", position: { x: 0, y: 28 }, label: "in" }],
};

const tools: readonly { label: string; tool: CanvasTool }[] = [
  { label: "Connect", tool: connectTool },
  { label: "Select", tool: selectTool },
];

function nodeLabel(node: DrawNode): string {
  const label = node.metadata?.label;
  return typeof label === "string" ? label : node.type;
}

function renderNode(node: DrawNode) {
  return <div className="editor-node" data-kind={node.type}>{nodeLabel(node)}</div>;
}

export default function ConnectionsPage() {
  const [controller] = useState(() => createDrawController({ version: 1, nodes }));
  const [tool, setTool] = useState(selectTool);
  const [commits, setCommits] = useState(0);
  const [showPorts, setShowPorts] = useState(true);
  const [ready, setReady] = useState(false);
  const canvas = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setReady(true);
    return controller.subscribeCommitted(() => setCommits((count) => count + 1));
  }, [controller]);

  const getPorts = (node: DrawNode): readonly DrawPort[] =>
    showPorts ? nodePorts[node.id] ?? [] : [];

  return (
    <main className="editor">
      <header className="editor-header">
        <h1>Workflow canvas</h1>
        <div className="editor-actions" aria-label="Document actions" role="group">
          <Button disabled={!ready} onClick={() => controller.commands.undo()}>Undo</Button>
          <Button disabled={!ready} onClick={() => controller.commands.redo()}>Redo</Button>
        </div>
      </header>
      <div className="editor-tools" aria-label="Canvas tools" role="group">
        {tools.map(({ label, tool: choice }) => (
          <Toggle key={choice.id} disabled={!ready} pressed={tool === choice} onPressedChange={() => {
            setTool(choice);
            canvas.current?.focus();
          }}>{label}</Toggle>
        ))}
        <Button disabled={!ready} onClick={() => setShowPorts((show) => !show)}>
          {showPorts ? "Hide named ports" : "Show named ports"}
        </Button>
      </div>
      <DrawCanvas
        ref={canvas}
        className="editor-canvas"
        aria-label="Workflow canvas"
        aria-describedby="connection-keys"
        controller={controller}
        tool={tool}
        renderNode={renderNode}
        getNodeLabel={nodeLabel}
        getPorts={getPorts}
        getConnectionPath={(_connection, { source, target }) => [{ to: target, control: { x: target.x, y: source.y - 80 } }]}
        renderConnectionLine={(_connection, geometry) => <path className="draw-connection-line" data-testid="workflow-line" d={geometry.path} />}
        renderArrowhead={(_connection, geometry) => (
          <path data-testid="workflow-head" d={defaultArrowheadPath} transform={connectionArrowheadTransform(geometry.arrowhead)} />
        )}
      />
      <footer className="editor-footer">
        <p id="connection-keys">Connect drags between nodes or ports. Select a connection and drag an endpoint to reconnect. [ and ] select nodes, . and , choose a port, Enter connects, arrows move, Delete removes.</p>
        <p>Workflow edits: <output aria-label="Workflow edits">{commits} edit{commits === 1 ? "" : "s"}</output></p>
      </footer>
    </main>
  );
}
