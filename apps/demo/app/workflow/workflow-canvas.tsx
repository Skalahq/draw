"use client";

import type { DrawDocument, DrawNode } from "@skalahq/draw/core";
import { DrawCanvas, type DrawCanvasProps, type NodeRenderers, type NodeRenderProps } from "@skalahq/draw/react";
import { Button } from "@ui-sdk/react/button";
import { useRef, useState } from "react";
import { solidReviewRenderer } from "./solid-review";
import "./workflow.css";

export function createWorkflowDocument(): DrawDocument {
  return {
    version: 1,
    nodes: [
      {
        id: "workflow-react",
        type: "react.note",
        bounds: { x: 48, y: 52, width: 248, height: 176 },
        metadata: { label: "React note" },
      },
      {
        id: "workflow-solid",
        type: "solid.review",
        bounds: { x: 336, y: 52, width: 232, height: 148 },
        metadata: { label: "Solid review" },
      },
      {
        id: "workflow-external",
        type: "external.step",
        bounds: { x: 48, y: 280, width: 232, height: 80 },
        metadata: { label: "External step", source: { system: "inventory", key: "M-72" } },
      },
    ],
  };
}

function nodeLabel(node: DrawNode) {
  const label = node.metadata?.label;
  return typeof label === "string" ? label : node.type;
}

function ReactNote({ node, resize }: NodeRenderProps) {
  const [showPreview, setShowPreview] = useState(false);
  const note = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState("");

  return (
    <div className="workflow-node" ref={note}>
      <h2>{nodeLabel(node)}</h2>
      <label>Note<input type="text" onChange={(event) => setDraft(event.currentTarget.value)} /></label>
      <div className="workflow-node-actions">
        <Button onClick={() => setShowPreview(!showPreview)}>{showPreview ? "Hide preview" : "Show preview"}</Button>
        <Button onClick={() => {
          if (note.current) resize({ width: node.bounds.width, height: note.current.offsetHeight });
        }}>Fit node to content</Button>
      </div>
      {showPreview ? (
        <section className="workflow-note-preview">
          <strong>Draft preview</strong>
          <p>{draft || "No note text yet."}</p>
        </section>
      ) : null}
    </div>
  );
}

export function createWorkflowNodeRenderers(onSolidMountChange?: (delta: 1 | -1) => void): NodeRenderers {
  return {
    "react.note": { render: ReactNote },
    "solid.review": solidReviewRenderer(onSolidMountChange),
  };
}

const defaultRenderers = createWorkflowNodeRenderers();

export function WorkflowCanvas({
  className,
  nodeRenderers = defaultRenderers,
  getNodeLabel = nodeLabel,
  "aria-label": label = "Workflow canvas",
  ...props
}: DrawCanvasProps) {
  return (
    <DrawCanvas
      {...props}
      aria-label={label}
      className={className ? `editor-canvas workflow-canvas ${className}` : "editor-canvas workflow-canvas"}
      getNodeLabel={getNodeLabel}
      nodeRenderers={nodeRenderers}
    />
  );
}
