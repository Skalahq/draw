"use client";

import { createDrawController, selectTool, type DrawDocument, type DrawNode } from "@skalahq/draw/core";
import { DrawCanvas } from "@skalahq/draw/react";
import { Button } from "@ui-sdk/react/button";
import { useEffect, useState } from "react";
import { DocumentJsonActions } from "./document-json-actions";
import "./json.css";

function nodeLabel(node: DrawNode): string {
  if (node.type === "note" && typeof node.metadata?.label === "string") return node.metadata.label;
  return node.type;
}

function renderNode(node: DrawNode) {
  if (node.type === "note") return <div className="editor-node">{nodeLabel(node)}</div>;
}

export default function JsonPage() {
  const [{ controller, session }, setOpen] = useState(() => ({ controller: createDrawController(), session: 0 }));
  const [ready, setReady] = useState(false);
  useEffect(() => { setReady(true); }, []);

  function open(snapshot: DrawDocument) {
    const controller = createDrawController(snapshot);
    setOpen(({ session }) => ({ controller, session: session + 1 }));
  }

  function addNote() {
    const offset = (controller.getSnapshot().nodes.length % 6) * 16;
    controller.commands.insertNode({
      id: crypto.randomUUID(),
      type: "note",
      bounds: { x: 48 + offset, y: 44 + offset, width: 144, height: 80 },
      metadata: { label: "Note" },
    });
  }

  return (
    <main className="editor json-editor">
      <header className="editor-header">
        <h1>Draw JSON</h1>
        <div className="editor-actions" aria-label="Document actions" role="group">
          <Button disabled={!ready} onClick={addNote}>Add note</Button>
          <Button disabled={!ready} onClick={() => { controller.commands.undo(); }}>Undo</Button>
          <Button disabled={!ready} onClick={() => { controller.commands.redo(); }}>Redo</Button>
        </div>
      </header>
      <DocumentJsonActions disabled={!ready} getSnapshot={controller.getSnapshot} onImport={open} />
      <DrawCanvas
        key={session}
        className="editor-canvas"
        aria-describedby="json-canvas-keys"
        controller={controller}
        tool={selectTool}
        getNodeLabel={nodeLabel}
        renderNode={renderNode}
      />
      <footer className="editor-footer">
        <p id="json-canvas-keys">Use [ and ] to select a node, arrow keys to move it, and Delete to remove it.</p>
      </footer>
    </main>
  );
}
