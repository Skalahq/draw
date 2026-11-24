import { announce, bindDrag, createViewport, definePrimitive, live, type SlotDefinition, type Viewport } from "@ui-sdk/core";
import type { DrawController, DrawNode, Point } from "./core.js";
import { createConnectionEditing, type ConnectionViewState } from "./connection-editing.js";
import type { ConnectionGeometryOptions } from "./connections.js";
import { boundsGesture, panTool, selectTool, type CanvasTool, type ToolContext } from "./tools.js";
import { strokeContainsPoint, strokeNodeType, strokeWidth } from "./stroke.js";

export type CanvasOptions = ConnectionGeometryOptions & {
  controller: DrawController;
  tool?: CanvasTool;
};

type PrimitiveOptions = Omit<CanvasOptions, "controller"> & { documentController: DrawController };
type CanvasState = { viewport: Viewport; selected: string | null; connectionView: ConnectionViewState };
type CanvasApi = {
  click(event: MouseEvent, root: HTMLElement): void;
  keyDown(event: KeyboardEvent, root: HTMLElement): void;
  wheel(event: WheelEvent, root: HTMLElement): void;
  pointerDown(event: PointerEvent, root: HTMLElement): void;
  worldStyle(state: CanvasState): string;
};
type CanvasSlots = {
  root: SlotDefinition<CanvasState, CanvasApi, {}>;
  frame: SlotDefinition<CanvasState, CanvasApi, {}>;
  world: SlotDefinition<CanvasState, CanvasApi, {}>;
  node: SlotDefinition<CanvasState, CanvasApi, { value: string }>;
  connectionView: SlotDefinition<CanvasState, CanvasApi, {}, ConnectionViewState>;
};

const initialViewport = { x: 0, y: 0, zoom: 1 };
const nativeControls = "input, textarea, select, label, button:not([data-draw-move]), a[href], summary, [contenteditable], [tabindex], [data-draw-interactive]";
const arrows: Readonly<Record<string, Point | undefined>> = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
};

function targetInCanvas(target: EventTarget | null, root: HTMLElement): Element | null {
  if (!(target instanceof Element) || target.closest(".draw-canvas") !== root) return null;
  const control = target.closest(nativeControls);
  return control && control !== root && root.contains(control) ? null : target;
}

export const canvasPrimitive = definePrimitive<PrimitiveOptions, CanvasState, CanvasApi, CanvasSlots>({
  name: "draw-canvas",
  options: { documentController: "value", tool: "value", getPorts: "value", getConnectionPath: "value" },
  state: () => ({ viewport: initialViewport, selected: null, connectionView: {} }),
  live: ["viewport", "connectionView"],
  api(context) {
    const { element, options, store } = context;
    const viewport = createViewport(context, { key: "viewport", surface: () => element("frame") });
    let stopDrag: (() => void) | undefined;
    let previewElement: HTMLElement | undefined;
    let previewingConnectedNode = false;
    let strokePreview: SVGPathElement | undefined;
    let previous = options();

    function clearPreview() {
      strokePreview?.ownerSVGElement?.remove();
      strokePreview = undefined;
      if (!previewElement) return;
      previewElement.style.removeProperty("translate");
      previewElement.style.removeProperty("--draw-preview-width");
      previewElement.style.removeProperty("--draw-preview-height");
      previewElement.removeAttribute("data-draw-preview");
      if (previewingConnectedNode) writeConnections({ nodePreview: undefined });
      previewingConnectedNode = false;
      previewElement = undefined;
    }

    function cancelDrag() {
      stopDrag?.();
      stopDrag = undefined;
      clearPreview();
      connectionEditing.clearDraft();
    }

    context.onDestroy(cancelDrag);
    context.onOptions((next) => {
      if (next.documentController !== previous.documentController || next.tool !== previous.tool) {
        cancelDrag();
        connectionEditing.cancelKeyboard();
        if (store.get().connectionView.port) writeConnections({ port: undefined });
      }
      if (next.documentController !== previous.documentController) {
        store.set({ selected: null, viewport: initialViewport, connectionView: {} });
      }
      previous = next;
    });

    function writeConnections(patch: Partial<ConnectionViewState>) {
      store.set({ connectionView: { ...store.get().connectionView, ...patch } });
    }

    function nodeLabel(node: DrawNode) {
      return element("node", node.id)?.getAttribute("aria-label") ?? node.type;
    }

    const toolContext: ToolContext = {
      get commands() { return options().documentController.commands; },
      getSnapshot: () => options().documentController.getSnapshot(),
      toCanvas: ({ x, y }) => viewport.toCanvas(x, y),
      toClient: viewport.toScreen,
      center() {
        const { left, top, right, bottom } = viewport.visible();
        return { x: (left + right) / 2, y: (top + bottom) / 2 };
      },
      hitTest({ x, y }) {
        const { nodes } = toolContext.getSnapshot();
        for (let i = nodes.length - 1; i >= 0; i--) {
          const node = nodes[i];
          const b = node.bounds;
          if (x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height &&
              (node.type !== strokeNodeType || strokeContainsPoint(node, x, y))) return node;
        }
      },
      get connectionEditing() { return connectionEditing; },
      select(id) {
        connectionEditing.select();
        if (store.get().selected !== id) store.set({ selected: id });
      },
      startPan: viewport.pointerdown,
      previewNode(id, { offset, size }) {
        const el = element("node", id);
        if (previewElement && previewElement !== el) clearPreview();
        if (!el) return;
        if (previewElement !== el) {
          el.setAttribute("data-draw-preview", "");
          previewingConnectedNode = !!toolContext.getSnapshot().connections?.some(
            (connection) => connection.source.nodeId === id || connection.target.nodeId === id,
          );
        }
        previewElement = el;
        if (offset) el.style.translate = `${offset.x}px ${offset.y}px`;
        if (size) {
          el.style.setProperty("--draw-preview-width", `${size.width}px`);
          el.style.setProperty("--draw-preview-height", `${size.height}px`);
        }
        if (previewingConnectedNode) writeConnections({ nodePreview: { id, offset, size } });
      },
      previewStroke(d) {
        if (!strokePreview) {
          const world = element("world");
          if (!world) return;
          const ns = "http://www.w3.org/2000/svg";
          const svg = world.ownerDocument.createElementNS(ns, "svg");
          svg.setAttribute("aria-hidden", "true");
          svg.setAttribute("class", "draw-stroke-preview");
          strokePreview = world.ownerDocument.createElementNS(ns, "path");
          strokePreview.setAttribute("fill", "none");
          strokePreview.setAttribute("stroke", "currentColor");
          strokePreview.setAttribute("stroke-width", String(strokeWidth));
          strokePreview.setAttribute("stroke-linecap", "round");
          strokePreview.setAttribute("stroke-linejoin", "round");
          svg.append(strokePreview);
          world.append(svg);
        }
        strokePreview.setAttribute("d", d);
      },
    };

    function selectMoveHandle(target: Element) {
      const id = target.closest("[data-draw-move]")?.getAttribute("data-draw-move");
      if (!id) return;
      const node = toolContext.getSnapshot().nodes.find((node) => node.id === id);
      if (!node) return;
      toolContext.select(node.id);
      return node;
    }
    const connectionEditing = createConnectionEditing({
      context: toolContext,
      read: () => store.get().connectionView,
      write: writeConnections,
      options,
      zoom: () => store.get().viewport.zoom,
      selectedNode: () => toolContext.getSnapshot().nodes.find((node) => node.id === store.get().selected),
      chooseNode(node) {
        toolContext.select(node.id);
        reveal(node);
      },
      nodeLabel,
      announce(message) {
        const root = element("root");
        if (root) announce(message, { doc: root.ownerDocument });
      },
    });

    function reveal(node: DrawNode) {
      const { x, y, width, height } = node.bounds;
      viewport.reveal({ left: x, top: y, right: x + width, bottom: y + height }, { padding: 16 });
    }

    function keyDown(event: KeyboardEvent, root: HTMLElement) {
      if (event.target !== root || event.isComposing) return;
      const { key } = event;
      if (stopDrag) {
        if (key === "Escape") cancelDrag();
        event.preventDefault();
        return;
      }
      const { commands } = toolContext;
      if (event.ctrlKey || event.metaKey) {
        if (event.altKey || key.toLowerCase() !== "z") return;
        event.preventDefault();
        connectionEditing.cancelKeyboard();
        if (event.shiftKey) commands.redo();
        else commands.undo();
        return;
      }
      const tool = options().tool;
      if (tool?.keyDown?.(toolContext, event) || viewport.keydown(event)) {
        event.preventDefault();
        return;
      }
      if (event.altKey) return;
      if (key === "Escape") {
        toolContext.select(null);
        return;
      }
      const { nodes, connections } = toolContext.getSnapshot();
      const { selected } = store.get();
      const selectedConnection = store.get().connectionView.selected;
      const index = nodes.findIndex(({ id }) => id === selected);
      if ((key === "[" || key === "]") && nodes.length) {
        event.preventDefault();
        const step = key === "]" ? 1 : -1;
        const node = nodes[index < 0 ? (step > 0 ? 0 : nodes.length - 1) : (index + step + nodes.length) % nodes.length];
        toolContext.select(node.id);
        reveal(node);
        announce(`${nodeLabel(node)} selected`, { doc: root.ownerDocument });
      } else if (selectedConnection !== undefined && connections?.some(({ id }) => id === selectedConnection) &&
                 (key === "Backspace" || key === "Delete")) {
        event.preventDefault();
        connectionEditing.select();
        commands.deleteConnection(selectedConnection);
      } else if (index >= 0 && (key === "Backspace" || key === "Delete")) {
        event.preventDefault();
        commands.deleteNode(nodes[index].id);
      } else if (arrows[key] && (index >= 0 || tool === panTool)) {
        event.preventDefault();
        const { x, y } = arrows[key];
        if (tool === panTool) viewport.panBy(-x * 40, -y * 40);
        else {
          const { id, bounds } = nodes[index];
          const step = event.shiftKey ? 10 : 1;
          if (commands.moveNode(id, { x: bounds.x + x * step, y: bounds.y + y * step })) {
            const moved = toolContext.getSnapshot().nodes.find((node) => node.id === id);
            if (moved) reveal(moved);
          }
        }
      }
    }

    return {
      keyDown,
      click(event: MouseEvent, root: HTMLElement) {
        if (event.detail !== 0 || stopDrag || options().tool !== selectTool) return;
        const target = targetInCanvas(event.target, root);
        const node = target && selectMoveHandle(target);
        if (node) {
          root.focus({ preventScroll: true });
          reveal(node);
        }
      },
      wheel(event: WheelEvent, root: HTMLElement) {
        if (targetInCanvas(event.target, root)) {
          if (stopDrag) event.preventDefault();
          else viewport.wheel(event);
        }
      },
      pointerDown(event: PointerEvent, root: HTMLElement) {
        const target = targetInCanvas(event.target, root);
        if (!target || event.button !== 0 || stopDrag) return;
        root.focus({ preventScroll: true });
        const tool = options().tool;
        if (!tool) return;
        const moveNode = tool === selectTool ? selectMoveHandle(target) : undefined;
        const resizeId = tool === selectTool && !moveNode
          ? target.closest("[data-draw-resize]")?.getAttribute("data-draw-resize")
          : null;
        const resizeNode = resizeId ? toolContext.getSnapshot().nodes.find(({ id }) => id === resizeId) : undefined;
        const handleNode = moveNode ?? resizeNode;
        if (moveNode) event.preventDefault();
        const gesture = handleNode
          ? boundsGesture(toolContext, handleNode, viewport.toCanvas(event.clientX, event.clientY), !!resizeNode)
          : tool.pointerDown?.(toolContext, event);
        if (!gesture) return;
        stopDrag = bindDrag(root, event, {
          cancelOnEscape: true,
          onMove: ({ x, y, event }) => gesture.preview?.({ x, y }, event),
          onEnd(end, canceled) {
            stopDrag = undefined;
            clearPreview();
            connectionEditing.clearDraft();
            if (!canceled) gesture.commit({ x: end.clientX, y: end.clientY });
          },
        });
      },
      worldStyle: viewport.style,
    };
  },
  slots: (slot) => ({
    root: slot({
      role: "region",
      attrs: () => ({ tabindex: "0", "aria-label": "Drawing canvas" }),
      bind(el, { api }) {
        const wheel = (event: WheelEvent) => api.wheel(event, el);
        el.addEventListener("wheel", wheel, { passive: false });
        return () => el.removeEventListener("wheel", wheel);
      },
      on: {
        click: (event, { api, el }) => { if (el) api.click(event, el); },
        pointerdown: (event, { api, el }) => { if (el) api.pointerDown(event, el); },
        keydown: (event, { api, el }) => { if (el) api.keyDown(event, el); },
      },
    }),
    frame: slot({}),
    world: slot({ live: live((state, { api }) => ({ style: api.worldStyle(state) })) }),
    connectionView: slot({ state: (state) => state.connectionView }),
    node: slot<{ value: string }>({
      role: "group",
      props: { value: "string" },
      attrs: (state, { key }) => ({ "data-selected": state.selected === key ? "" : undefined }),
    }),
  }),
  agent: { actions: [] },
});
