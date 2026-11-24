import { createParts } from "@ui-sdk/web";
import { canvasPrimitive, type CanvasOptions } from "./canvas.js";
import type { DrawNode, Size } from "./core.js";
import { selectTool } from "./tools.js";

export type NodeRenderProps = {
  node: DrawNode;
  resize(size: Size): boolean;
};

export type MountedNodeRenderer = {
  update(props: NodeRenderProps): void;
  dispose(): void;
};

export type ForeignNodeRenderer = {
  mount(container: HTMLElement): MountedNodeRenderer;
};

export type DrawDomOptions = CanvasOptions & {
  ariaLabel?: string;
  getNodeLabel?: (node: DrawNode) => string;
  nodeRenderers?: Readonly<Record<string, ForeignNodeRenderer | undefined>>;
};

export type MountedDraw = {
  update(options: Partial<DrawDomOptions>): void;
  dispose(): void;
};

const tags = {
  root: "skalahq-draw-canvas",
  frame: "skalahq-draw-frame",
  world: "skalahq-draw-world",
  node: "skalahq-draw-node",
} as const;

createParts(canvasPrimitive, { ...tags, root: { tag: tags.root, display: "block" } });

type CanvasElement = HTMLElement & {
  documentController: DrawDomOptions["controller"];
  tool: DrawDomOptions["tool"];
};

type NodeView = {
  shell: HTMLElement;
  content: HTMLDivElement;
  resizeHandle?: HTMLSpanElement;
  node?: DrawNode;
  renderer?: ForeignNodeRenderer;
  mounted?: MountedNodeRenderer;
  resize: NodeRenderProps["resize"];
};

export function mountDraw(container: HTMLElement, initial: DrawDomOptions): MountedDraw {
  const doc = container.ownerDocument;
  const root = doc.createElement(tags.root) as CanvasElement;
  const frame = doc.createElement(tags.frame);
  const world = doc.createElement(tags.world);
  root.className = "draw-canvas";
  root.style.height = "100%";
  frame.className = "draw-frame";
  world.className = "draw-world";
  root.append(frame);
  frame.append(world);

  const views = new Map<string, NodeView>();
  let options = { ...initial };
  let disposed = false;
  let rendering = false;
  let needsRender = false;

  function removeView(id: string, view: NodeView) {
    views.delete(id);
    view.mounted?.dispose();
    view.shell.remove();
  }

  function clearViews() {
    for (const [id, view] of views) removeView(id, view);
  }

  function createView(id: string): NodeView {
    const shell = doc.createElement(tags.node);
    const content = doc.createElement("div");
    const { controller } = options;
    shell.className = "draw-node";
    shell.setAttribute("value", id);
    shell.append(content);
    const view: NodeView = {
      shell,
      content,
      resize: (size) => views.get(id) === view && controller.commands.resizeNode(id, size),
    };
    views.set(id, view);
    return view;
  }

  function renderNode(view: NodeView, node: DrawNode) {
    const { shell, content } = view;
    const { nodeRenderers, getNodeLabel, tool } = options;
    const renderer = nodeRenderers && Object.hasOwn(nodeRenderers, node.type) ? nodeRenderers[node.type] : undefined;
    const changed = node !== view.node;
    const changedRenderer = renderer !== view.renderer;
    if (changed && node.bounds !== view.node?.bounds) {
      const { x, y, width, height } = node.bounds;
      shell.style.left = `${x}px`;
      shell.style.top = `${y}px`;
      shell.style.width = `var(--draw-preview-width, ${width}px)`;
      shell.style.height = `var(--draw-preview-height, ${height}px)`;
    }
    const label = getNodeLabel?.(node) ?? node.type;
    if (shell.getAttribute("aria-label") !== label) shell.setAttribute("aria-label", label);
    if (changedRenderer) {
      view.mounted?.dispose();
      content.replaceChildren();
      view.renderer = renderer;
      view.mounted = renderer?.mount(content);
    }
    view.node = node;
    if (view.mounted) {
      if (changed || changedRenderer) view.mounted.update({ node, resize: view.resize });
    } else if (content.textContent !== node.type) {
      content.textContent = node.type;
    }

    if (tool === selectTool) {
      if (!view.resizeHandle) {
        view.resizeHandle = doc.createElement("span");
        view.resizeHandle.className = "draw-resize";
        view.resizeHandle.setAttribute("aria-hidden", "true");
        view.resizeHandle.setAttribute("data-draw-resize", node.id);
      }
      if (!view.resizeHandle.parentNode) shell.append(view.resizeHandle);
    } else {
      view.resizeHandle?.remove();
    }
  }

  function render() {
    if (disposed) return;
    if (rendering) {
      needsRender = true;
      return;
    }
    rendering = true;
    try {
      do {
        needsRender = false;
        const { nodes } = options.controller.getSnapshot();
        const ids = new Set<string>();
        for (const { id } of nodes) ids.add(id);
        for (const [id, view] of views) {
          if (!ids.has(id)) removeView(id, view);
        }
        let next = world.firstChild;
        for (const node of nodes) {
          const view = views.get(node.id) ?? createView(node.id);
          if (view.shell !== next) world.insertBefore(view.shell, next);
          next = view.shell.nextSibling;
          renderNode(view, node);
        }
      } while (needsRender && !disposed);
    } finally {
      rendering = false;
    }
  }

  function setLabel() {
    if (options.ariaLabel === undefined) root.removeAttribute("aria-label");
    else root.setAttribute("aria-label", options.ariaLabel);
  }

  root.documentController = options.controller;
  root.tool = options.tool;
  setLabel();
  container.append(root);
  let unsubscribe = options.controller.subscribeCommitted(render);
  render();

  return {
    update(patch) {
      if (disposed) return;
      const previous = options;
      options = { ...options, ...patch };
      if (options.controller !== previous.controller) {
        unsubscribe();
        clearViews();
        root.documentController = options.controller;
        unsubscribe = options.controller.subscribeCommitted(render);
      }
      if (options.tool !== previous.tool) root.tool = options.tool;
      if (options.ariaLabel !== previous.ariaLabel) setLabel();
      render();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribe();
      root.tool = undefined;
      root.remove();
      clearViews();
    },
  };
}
