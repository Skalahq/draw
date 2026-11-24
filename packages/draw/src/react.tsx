"use client";

import { createParts } from "@ui-sdk/react/primitive";
import { memo, useSyncExternalStore, type ReactNode, type Ref } from "react";
import { canvasPrimitive, type CanvasOptions } from "./canvas.js";
import type { DrawNode } from "./core.js";
import { selectTool } from "./tools.js";

const Parts = createParts(canvasPrimitive, { root: "div", frame: "div", world: "div", node: "div" });

export type DrawCanvasProps = CanvasOptions & {
  ref?: Ref<HTMLDivElement>;
  className?: string;
  "aria-label"?: string;
  "aria-describedby"?: string;
  renderNode?: (node: DrawNode) => ReactNode;
  getNodeLabel?: (node: DrawNode) => string;
};

const NodeShell = memo(function NodeShell({ node, renderNode, getNodeLabel, resizable }: {
  node: DrawNode;
  renderNode: DrawCanvasProps["renderNode"];
  getNodeLabel: DrawCanvasProps["getNodeLabel"];
  resizable: boolean;
}) {
  const { x, y, width, height } = node.bounds;
  return (
    <Parts.Node
      value={node.id}
      className="draw-node"
      aria-label={getNodeLabel?.(node) ?? node.type}
      style={{ left: x, top: y, width: `var(--draw-preview-width, ${width}px)`, height: `var(--draw-preview-height, ${height}px)` }}
    >
      {renderNode?.(node) ?? <span>{node.type}</span>}
      {resizable && <span aria-hidden="true" className="draw-resize" data-draw-resize={node.id} />}
    </Parts.Node>
  );
});

export function DrawCanvas({ controller, tool, renderNode, getNodeLabel, className, ...props }: DrawCanvasProps) {
  const document = useSyncExternalStore(controller.subscribeCommitted, controller.getSnapshot, controller.getSnapshot);
  return (
    <Parts.Root
      {...props}
      documentController={controller}
      tool={tool}
      className={className ? `draw-canvas ${className}` : "draw-canvas"}
    >
      <Parts.Frame className="draw-frame">
        <Parts.World className="draw-world">
          {document.nodes.map((node) => (
            <NodeShell key={node.id} node={node} renderNode={renderNode} getNodeLabel={getNodeLabel} resizable={tool === selectTool} />
          ))}
        </Parts.World>
      </Parts.Frame>
    </Parts.Root>
  );
}
