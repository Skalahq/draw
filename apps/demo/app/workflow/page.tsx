"use client";

import { connectTool, createDrawController, panTool, selectTool, type CanvasTool } from "@skalahq/draw/core";
import { Button } from "@ui-sdk/react/button";
import { useRef, useState, useSyncExternalStore } from "react";
import { createWorkflowDocument, createWorkflowNodeRenderers, WorkflowCanvas } from "./workflow-canvas";

export default function WorkflowPage() {
  const [liveSolidNodes, setLiveSolidNodes] = useState(0);
  const [editor] = useState(() => {
    const controller = createDrawController(createWorkflowDocument());
    const nodeRenderers = createWorkflowNodeRenderers((delta) => setLiveSolidNodes((live) => live + delta));
    return { controller, nodeRenderers, initial: controller.getSnapshot() };
  });
  const [visible, setVisible] = useState(true);
  const [tool, setTool] = useState(selectTool);
  const canvas = useRef<HTMLDivElement>(null);
  const { controller, nodeRenderers, initial } = editor;
  const document = useSyncExternalStore(controller.subscribeCommitted, controller.getSnapshot, controller.getSnapshot);
  const solid = document.nodes.find(({ id }) => id === "workflow-solid");

  function chooseTool(next: CanvasTool) {
    setTool(next);
    canvas.current?.focus();
  }

  return (
    <main className="editor workflow-editor">
      <header className="editor-header">
        <h1>Workflow canvas</h1>
        <div className="editor-actions">
          <Button disabled={document === initial} onClick={controller.commands.undo}>Undo</Button>
          <Button onClick={() => setVisible(!visible)}>{visible ? "Hide canvas" : "Show canvas"}</Button>
        </div>
      </header>
      <div className="editor-tools">
        <Button aria-pressed={tool === selectTool} onClick={() => chooseTool(selectTool)}>Select</Button>
        <Button aria-pressed={tool === panTool} onClick={() => chooseTool(panTool)}>Pan</Button>
        <Button aria-pressed={tool === connectTool} onClick={() => chooseTool(connectTool)}>Connect</Button>
        <Button disabled={!solid} onClick={() => {
          if (solid) controller.commands.moveNode(solid.id, { x: solid.bounds.x + 16, y: solid.bounds.y });
        }}>Nudge Solid node</Button>
      </div>
      {visible ? (
        <WorkflowCanvas ref={canvas} controller={controller} tool={tool} nodeRenderers={nodeRenderers} />
      ) : (
        <div className="workflow-empty">Canvas is hidden. The document stays open.</div>
      )}
      <footer className="editor-footer">
        <p>Drag a node by its handle. With canvas focus, [ and ] select nodes; arrows move them.</p>
        <p>Live Solid nodes: <output aria-label="Live Solid nodes">{liveSolidNodes}</output></p>
      </footer>
      <details className="workflow-document">
        <summary>Document snapshot</summary>
        <section aria-label="Document snapshot"><pre>{JSON.stringify(document, null, 2)}</pre></section>
      </details>
    </main>
  );
}
