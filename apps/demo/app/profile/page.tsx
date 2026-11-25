"use client";

import {
  createDrawController, freehandTool, panTool, selectTool, type CanvasTool, type DrawDocument, type DrawNode,
} from "@skalahq/draw/core";
import { DrawCanvas } from "@skalahq/draw/react";
import { Button } from "@ui-sdk/react/button";
import { useEffect, useMemo, useRef, useState } from "react";
import "../editor.css";
import { maxFrameGap, resetFrameGaps, sampleFrameGaps } from "./frame-gap";

const columns = 40;
const rows = 25;

function profileDocument(): DrawDocument {
  const nodes = [];
  const connections = [];
  for (let index = 0; index < rows * columns; index += 1) {
    const column = index % columns;
    const row = Math.floor(index / columns);
    nodes.push({
      id: `n${index}`,
      type: "note",
      bounds: { x: column * 48, y: row * 36, width: 32, height: 20 },
      metadata: { label: `N${index}` },
    });
    if (column > 0) {
      connections.push({
        id: `c${index}`,
        source: { nodeId: `n${index - 1}` },
        target: { nodeId: `n${index}` },
      });
    }
  }
  return { version: 1, nodes, connections };
}

function label(node: DrawNode) {
  return typeof node.metadata?.label === "string" ? node.metadata.label : node.type;
}

export default function ProfilePage() {
  const controller = useMemo(() => createDrawController(profileDocument()), []);
  const [tool, setTool] = useState<CanvasTool>(selectTool);
  const canvas = useRef<HTMLDivElement>(null);
  const gap = useRef<HTMLOutputElement>(null);
  const nodes = useRef<HTMLOutputElement>(null);
  const links = useRef<HTMLOutputElement>(null);

  useEffect(() => {
    const stopFrames = sampleFrameGaps();
    const timer = setInterval(() => {
      if (gap.current) gap.current.textContent = String(Math.round(maxFrameGap()));
    }, 250);
    const stopCommits = controller.subscribeCommitted((document) => {
      if (nodes.current) nodes.current.textContent = String(document.nodes.length);
      if (links.current) links.current.textContent = String(document.connections?.length ?? 0);
    });
    return () => {
      stopFrames();
      stopCommits();
      clearInterval(timer);
    };
  }, [controller]);

  function choose(choice: CanvasTool) {
    setTool(choice);
    canvas.current?.focus();
  }

  return (
    <main className="editor">
      <header className="editor-header">
        <h1>Profile</h1>
        <p>Frame gap <output ref={gap} aria-label="Max frame gap">0</output> ms</p>
        <p>Nodes <output ref={nodes} aria-label="Node count">1000</output></p>
        <p>Connections <output ref={links} aria-label="Connection count">975</output></p>
      </header>
      <div className="editor-tools" aria-label="Canvas tools" role="group">
        <Button aria-pressed={tool === selectTool} onClick={() => choose(selectTool)}>Select</Button>
        <Button aria-pressed={tool === panTool} onClick={() => choose(panTool)}>Pan</Button>
        <Button aria-pressed={tool === freehandTool} onClick={() => choose(freehandTool)}>Freehand</Button>
        <Button onClick={() => {
          resetFrameGaps();
          if (gap.current) gap.current.textContent = "0";
        }}>Reset frame gaps</Button>
      </div>
      <DrawCanvas
        ref={canvas}
        className="editor-canvas"
        aria-label="Profile canvas"
        controller={controller}
        tool={tool}
        getNodeLabel={label}
        renderNode={(node) => <div className="editor-node">{label(node)}</div>}
      />
    </main>
  );
}
