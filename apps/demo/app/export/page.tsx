"use client";

import {
  createDrawController, exportDrawPng, exportDrawSvg, freehandTool, panTool, selectTool, strokeNodeType,
  type DrawDocument, type DrawNode, type DrawNodeExport,
} from "@skalahq/draw/core";
import { DrawCanvas } from "@skalahq/draw/react";
import { Button } from "@ui-sdk/react/button";
import { Toggle } from "@ui-sdk/react/toggle";
import { useEffect, useRef, useState } from "react";
import "./export.css";

const noteBounds = { x: 40, y: 48, width: 160, height: 72 };
const drawing: DrawDocument = {
  version: 1,
  nodes: [
    { id: "note", type: "note", bounds: noteBounds, metadata: { label: "Field note" } },
    { id: "badge", type: "badge", bounds: { x: 280, y: 48, width: 120, height: 72 }, metadata: { label: "Badge" } },
    {
      id: "stroke",
      type: strokeNodeType,
      bounds: { x: 40, y: 140, width: 120, height: 20 },
      metadata: { points: [{ x: 2, y: 10 }, { x: 118, y: 10 }] },
    },
    { id: "widget", type: "live-widget", bounds: { x: 40, y: 200, width: 160, height: 72 }, metadata: { label: "Live widget" } },
  ],
  connections: [{ id: "link", source: { nodeId: "note" }, target: { nodeId: "badge" } }],
};

function nodeLabel(node: DrawNode): string {
  if (node.type === strokeNodeType) return "Freehand stroke";
  return typeof node.metadata?.label === "string" ? node.metadata.label : node.type;
}

function exportNode(node: DrawNode): DrawNodeExport | undefined {
  if (node.type === "badge") {
    return [
      { kind: "rect", x: 0, y: 0, width: node.bounds.width, height: node.bounds.height, fill: "#779961" },
      { kind: "text", x: 8, y: node.bounds.height / 2, text: "Badge", fill: "#ffffff" },
    ];
  }
  if (node.type === "live-widget") return "unsupported";
}

function renderNode(node: DrawNode) {
  if (node.type === "live-widget") return <div className="editor-node">Secret widget chrome</div>;
  if (node.type === "badge") return <div className="editor-node" data-kind="marker">Badge</div>;
  return <div className="editor-node">{nodeLabel(node)}</div>;
}

function pngBlob(png: Uint8Array) {
  const copy = new ArrayBuffer(png.byteLength);
  new Uint8Array(copy).set(png);
  return new Blob([copy], { type: "image/png" });
}

function saveFile(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export default function ExportPage() {
  const [controller] = useState(() => createDrawController(drawing));
  const [tool, setTool] = useState(selectTool);
  const [ready, setReady] = useState(false);
  const [crop, setCrop] = useState(false);
  const [doubled, setDoubled] = useState(false);
  const [svgSize, setSvgSize] = useState("Not exported");
  const [pngSize, setPngSize] = useState("Not exported");
  const [unsupported, setUnsupported] = useState("Not exported");
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<string>();
  const canvas = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setReady(true);
    return () => { if (preview) URL.revokeObjectURL(preview); };
  }, [preview]);

  function options() {
    return {
      crop: crop ? noteBounds : undefined,
      scale: doubled ? 2 : 1,
      getNodeLabel: nodeLabel,
      exportNode,
    };
  }

  function exportSvg() {
    try {
      const exported = exportDrawSvg(controller.getSnapshot(), options());
      saveFile("drawing.svg", new Blob([exported.svg], { type: "image/svg+xml" }));
      setSvgSize(`${exported.width} by ${exported.height}`);
      setUnsupported(exported.unsupported.map((item) => `${item.id} ${item.type}`).join(", ") || "None");
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not export SVG.");
    }
  }

  function exportPng() {
    try {
      const exported = exportDrawPng(controller.getSnapshot(), options());
      const png = pngBlob(exported.png);
      saveFile("drawing.png", png);
      setPngSize(`${exported.width} by ${exported.height}`);
      setUnsupported(exported.unsupported.map((item) => `${item.id} ${item.type}`).join(", ") || "None");
      setPreview((current) => {
        if (current) URL.revokeObjectURL(current);
        return URL.createObjectURL(png);
      });
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not export PNG.");
    }
  }

  return (
    <main className="editor">
      <header className="editor-header">
        <h1>Export drawing</h1>
        <div className="editor-actions" aria-label="Export actions" role="group">
          <Button disabled={!ready} onClick={exportSvg}>Export SVG</Button>
          <Button disabled={!ready} onClick={exportPng}>Export PNG</Button>
        </div>
      </header>
      <div className="editor-tools" aria-label="Canvas tools" role="group">
        {[
          { label: "Select", tool: selectTool },
          { label: "Pan", tool: panTool },
          { label: "Freehand", tool: freehandTool },
        ].map(({ label, tool: choice }) => (
          <Toggle key={choice.id} disabled={!ready} pressed={tool === choice} onPressedChange={() => {
            setTool(choice);
            canvas.current?.focus();
          }}>{label}</Toggle>
        ))}
        <Toggle disabled={!ready} pressed={crop} onPressedChange={setCrop}>Crop to note</Toggle>
        <Toggle disabled={!ready} pressed={doubled} onPressedChange={setDoubled}>PNG scale 2x</Toggle>
      </div>
      <DrawCanvas
        ref={canvas}
        className="editor-canvas"
        controller={controller}
        tool={tool}
        getNodeLabel={nodeLabel}
        renderNode={renderNode}
      />
      <footer className="editor-footer export-footer">
        <p>Export uses the committed snapshot. Pan, zoom, selection, and a stroke preview stay out of the file. A live widget without an export representation is reported, not drawn.</p>
        <p>SVG <output aria-label="SVG dimensions">{svgSize}</output></p>
        <p>PNG <output aria-label="PNG dimensions">{pngSize}</output></p>
        <p aria-label="Unsupported content">{unsupported}</p>
        {error ? <p role="alert">{error}</p> : null}
        {preview ? <img className="export-preview" src={preview} alt="Exported PNG preview" /> : null}
      </footer>
    </main>
  );
}
