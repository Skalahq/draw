"use client";

import { createDrawController, freehandTool, insertNodeTool, panTool, selectTool, strokeNodeType, type DrawNode } from "@skalahq/draw/core";
import { DrawCanvas } from "@skalahq/draw/react";
import { Button } from "@ui-sdk/react/button";
import { Toggle } from "@ui-sdk/react/toggle";
import { useEffect, useRef, useState } from "react";

function createEditor() {
  let sequence = 0;
  const insertNote = insertNodeTool(({ x, y }) => {
    const number = ++sequence;
    return {
      id: `sketch-note-${number}`,
      type: "note",
      bounds: { x: x - 72, y: y - 40, width: 144, height: 80 },
      metadata: { label: `Sketch note ${number}` },
    };
  });
  return {
    controller: createDrawController(),
    tools: [
      { label: "Freehand", tool: freehandTool },
      { label: "Select", tool: selectTool },
      { label: "Pan", tool: panTool },
      { label: "Insert note", tool: insertNote },
    ],
  };
}

function nodeLabel(node: DrawNode): string {
  if (node.type === strokeNodeType) return "Freehand stroke";
  return typeof node.metadata?.label === "string" ? node.metadata.label : node.type;
}

function renderNode(node: DrawNode) {
  return <div className="editor-node">{nodeLabel(node)}</div>;
}

export default function SketchPage() {
  const [{ controller, tools }] = useState(createEditor);
  const [tool, setTool] = useState(freehandTool);
  const [commits, setCommits] = useState(0);
  const [ready, setReady] = useState(false);
  const canvas = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setReady(true);
    return controller.subscribeCommitted(() => setCommits((count) => count + 1));
  }, [controller]);

  return (
    <main className="editor">
      <header className="editor-header">
        <h1>Sketch canvas</h1>
        <div className="editor-actions" aria-label="Document actions" role="group">
          <Button disabled={!ready} onClick={() => { controller.commands.undo(); }}>Undo</Button>
          <Button disabled={!ready} onClick={() => { controller.commands.redo(); }}>Redo</Button>
        </div>
      </header>
      <div className="editor-tools" aria-label="Canvas tools" role="group">
        {tools.map(({ label, tool: choice }) => (
          <Toggle key={choice.id} disabled={!ready} pressed={tool === choice} onPressedChange={() => {
            setTool(choice);
            canvas.current?.focus();
          }}>{label}</Toggle>
        ))}
      </div>
      <DrawCanvas
        ref={canvas}
        className="editor-canvas"
        aria-describedby="sketch-keys"
        controller={controller}
        tool={tool}
        getNodeLabel={nodeLabel}
        renderNode={renderNode}
      />
      <footer className="editor-footer">
        <p id="sketch-keys">Draw with a mouse, pen, or finger. Escape cancels a stroke. With Insert note active, click the canvas or press Enter.</p>
        <p>Committed edits: <output aria-label="Committed edits">{commits}</output></p>
      </footer>
    </main>
  );
}
