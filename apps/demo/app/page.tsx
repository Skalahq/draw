"use client";

import { createDrawController, insertNodeTool, panTool, selectTool, type CanvasTool, type DrawNode, type Point } from "@skalahq/draw/core";
import { DrawCanvas } from "@skalahq/draw/react";
import { Button } from "@ui-sdk/react/button";
import { Toggle } from "@ui-sdk/react/toggle";
import { useEffect, useRef, useState } from "react";

function createEditor() {
  const controller = createDrawController();
  let sequence = 0;

  function createNode(type: "note" | "marker", at: Point): DrawNode {
    const number = ++sequence;
    const [width, height] = type === "note" ? [144, 80] : [96, 56];
    return {
      id: String(number),
      type,
      bounds: { x: at.x - width / 2, y: at.y - height / 2, width, height },
      metadata: { label: `${type === "note" ? "Note" : "Marker"} ${number}` },
    };
  }

  const marker: CanvasTool = {
    id: "marker",
    pointerDown(context) {
      return {
        commit(client) {
          const node = createNode("marker", context.toCanvas(client));
          if (context.commands.insertNode(node)) context.select(node.id);
        },
      };
    },
    keyDown(context, event) {
      if (event.key !== "Enter" || event.repeat) return false;
      const node = createNode("marker", context.center());
      if (context.commands.insertNode(node)) context.select(node.id);
      return true;
    },
  };

  return {
    controller,
    addNote() {
      const offset = (sequence % 6) * 16;
      controller.commands.insertNode(createNode("note", { x: 120 + offset, y: 105 + offset }));
    },
    tools: [
      { label: "Select", tool: selectTool },
      { label: "Pan", tool: panTool },
      { label: "Insert note", tool: insertNodeTool((point) => createNode("note", point)) },
      { label: "Stamp marker", tool: marker },
    ],
  };
}

function nodeLabel(node: DrawNode): string {
  const label = node.metadata?.label;
  return typeof label === "string" ? label : node.type;
}

function renderNode(node: DrawNode) {
  return <div className="editor-node" data-kind={node.type}>{nodeLabel(node)}</div>;
}

export default function Page() {
  const [editor] = useState(createEditor);
  const [tool, setTool] = useState(selectTool);
  const [commits, setCommits] = useState(0);
  const [ready, setReady] = useState(false);
  const canvas = useRef<HTMLDivElement>(null);
  const { controller } = editor;

  useEffect(() => {
    setReady(true);
    return controller.subscribeCommitted(() => setCommits((count) => count + 1));
  }, [controller]);

  return (
    <main className="editor">
      <header className="editor-header">
        <h1>First canvas</h1>
        <div className="editor-actions" aria-label="Document actions" role="group">
          <Button disabled={!ready} onClick={editor.addNote}>Add note</Button>
          <Button disabled={!ready} onClick={() => { controller.commands.undo(); }}>Undo</Button>
          <Button disabled={!ready} onClick={() => { controller.commands.redo(); }}>Redo</Button>
        </div>
      </header>
      <div className="editor-tools" aria-label="Canvas tools" role="group">
        {editor.tools.map(({ label, tool: choice }) => (
          <Toggle key={choice.id} disabled={!ready} pressed={tool === choice} onPressedChange={() => {
            setTool(choice);
            canvas.current?.focus();
          }}>{label}</Toggle>
        ))}
      </div>
      <DrawCanvas
        ref={canvas}
        className="editor-canvas"
        aria-describedby="canvas-keys"
        controller={controller}
        tool={tool}
        renderNode={renderNode}
        getNodeLabel={nodeLabel}
      />
      <footer className="editor-footer">
        <p id="canvas-keys">Enter inserts with an insert tool. [ and ] select, arrows move, Delete removes, + and − zoom.</p>
        <p>Committed edits: <output aria-label="Committed edits">{commits}</output></p>
      </footer>
    </main>
  );
}
