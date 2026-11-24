"use client";

import { createParts } from "@ui-sdk/react/primitive";
import { memo, useCallback, useLayoutEffect, useRef, useSyncExternalStore, type ComponentType, type ReactNode, type Ref } from "react";
import { canvasPrimitive, type CanvasOptions } from "./canvas.js";
import type { DrawController, DrawNode, Size } from "./core.js";
import type { ForeignNodeRenderer, MountedNodeRenderer, NodeRenderProps } from "./node-renderer.js";
import { ConnectionLayers, type ConnectionRenderOptions } from "./react-connections.js";
import { connectTool, selectTool } from "./tools.js";

export type { ForeignNodeRenderer, MountedNodeRenderer, NodeRenderProps } from "./node-renderer.js";
export type NodeRenderer = { render: ComponentType<NodeRenderProps> } | ForeignNodeRenderer;
export type NodeRenderers = Readonly<Record<string, NodeRenderer | undefined>>;

const Parts = createParts(canvasPrimitive, { root: "div", frame: "div", world: "div", node: "div", connectionView: "div" });

export type DrawCanvasProps = CanvasOptions & ConnectionRenderOptions & {
  ref?: Ref<HTMLDivElement>;
  className?: string;
  "aria-label"?: string;
  "aria-describedby"?: string;
  renderNode?: (node: DrawNode) => ReactNode;
  nodeRenderers?: NodeRenderers;
  getNodeLabel?: (node: DrawNode) => string;
};

function ForeignContent({ renderer, node, resize }: NodeRenderProps & { renderer: ForeignNodeRenderer }) {
  const container = useRef<HTMLDivElement>(null);
  const mounted = useRef<MountedNodeRenderer>(null);

  useLayoutEffect(() => {
    const instance = renderer.mount(container.current!);
    mounted.current = instance;
    return () => {
      mounted.current = null;
      instance.dispose();
    };
  }, [renderer]);

  useLayoutEffect(() => {
    mounted.current?.update({ node, resize });
  }, [renderer, node, resize]);

  return <div ref={container} className="draw-node-content" data-draw-interactive="" />;
}

const NodeShell = memo(function NodeShell({ controller, node, renderer, usesRegistry, renderNode, getNodeLabel, selectable }: {
  controller: DrawController;
  node: DrawNode;
  renderer: NodeRenderer | undefined;
  usesRegistry: boolean;
  renderNode: DrawCanvasProps["renderNode"];
  getNodeLabel: DrawCanvasProps["getNodeLabel"];
  selectable: boolean;
}) {
  const { x, y, width, height } = node.bounds;
  const label = getNodeLabel?.(node) ?? node.type;
  const id = node.id;
  const resize = useCallback((size: Size) => controller.commands.resizeNode(id, size), [controller, id]);
  const ReactContent = renderer && "render" in renderer ? renderer.render : undefined;
  return (
    <Parts.Node
      value={id}
      className="draw-node"
      aria-label={label}
      style={{ left: x, top: y, width: `var(--draw-preview-width, ${width}px)`, height: `var(--draw-preview-height, ${height}px)` }}
    >
      {ReactContent ? (
        <div key={node.type} className="draw-node-content" data-draw-interactive="">
          <ReactContent node={node} resize={resize} />
        </div>
      ) : renderer && "mount" in renderer ? (
        <ForeignContent key={node.type} renderer={renderer} node={node} resize={resize} />
      ) : (
        renderNode?.(node) ?? (usesRegistry
          ? <span className="draw-node-placeholder">Unknown node type: {node.type}</span>
          : <span>{node.type}</span>)
      )}
      {selectable && usesRegistry ? (
        <button type="button" className="draw-move" aria-label={`Move ${label}`} data-draw-move={id} />
      ) : null}
      {selectable ? <span aria-hidden="true" className="draw-resize" data-draw-resize={id} /> : null}
    </Parts.Node>
  );
});

export function DrawCanvas({ controller, tool, renderNode, nodeRenderers, getNodeLabel, getPorts, getConnectionPath,
  renderConnectionLine, renderArrowhead, className, ...props }: DrawCanvasProps) {
  const document = useSyncExternalStore(controller.subscribeCommitted, controller.getSnapshot, controller.getSnapshot);
  return (
    <Parts.Root
      {...props}
      documentController={controller}
      tool={tool}
      getPorts={getPorts}
      getConnectionPath={getConnectionPath}
      className={className ? `draw-canvas ${className}` : "draw-canvas"}
    >
      <Parts.Frame className="draw-frame">
        <Parts.World className="draw-world">
          {(document.connections?.length || tool === connectTool) ? (
            <Parts.ConnectionView className="draw-connection-view">
              {(view) => <ConnectionLayers document={document} view={view} connecting={tool === connectTool}
                editable={tool === selectTool || tool === connectTool} getPorts={getPorts} getConnectionPath={getConnectionPath}
                renderConnectionLine={renderConnectionLine} renderArrowhead={renderArrowhead} />}
            </Parts.ConnectionView>
          ) : null}
          {document.nodes.map((node) => (
            <NodeShell
              key={node.id}
              controller={controller}
              node={node}
              renderer={nodeRenderers && Object.hasOwn(nodeRenderers, node.type) ? nodeRenderers[node.type] : undefined}
              usesRegistry={nodeRenderers !== undefined}
              renderNode={renderNode}
              getNodeLabel={getNodeLabel}
              selectable={tool === selectTool}
            />
          ))}
        </Parts.World>
      </Parts.Frame>
    </Parts.Root>
  );
}
