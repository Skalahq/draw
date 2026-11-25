import { announce, bindDrag, createViewport, definePrimitive, live, type SlotDefinition, type Viewport } from "@ui-sdk/core";
import { descendantGroupIds, descendantNodeIds, getGroupBounds, type DrawController, type DrawNode, type Point } from "./core.js";
import { createConnectionEditing, type ConnectionViewState } from "./connection-editing.js";
import type { ConnectionGeometryOptions } from "./connections.js";
import { boundsGesture, panTool, selectTool, type CanvasTool, type ToolContext } from "./tools.js";
import { strokeContainsPoint, strokeNodeType, strokeWidth } from "./stroke.js";

export type CanvasOptions = ConnectionGeometryOptions & {
  controller: DrawController;
  tool?: CanvasTool;
  onSelectionChange?: (ids: readonly string[]) => void;
};

type PrimitiveOptions = Omit<CanvasOptions, "controller"> & { documentController: DrawController };
type CanvasState = { viewport: Viewport; selected: string | null; selectedIds: readonly string[]; connectionView: ConnectionViewState };
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
  group: SlotDefinition<CanvasState, CanvasApi, { value: string }>;
  connectionView: SlotDefinition<CanvasState, CanvasApi, {}, ConnectionViewState>;
};

const initialViewport = { x: 0, y: 0, zoom: 1 };
const nativeControls = "input, textarea, select, label, button:not([data-draw-move]):not([data-draw-group-move]), a[href], summary, [contenteditable], [tabindex], [data-draw-interactive]";
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
  options: { documentController: "value", tool: "value", getPorts: "value", getConnectionPath: "value", onSelectionChange: "value" },
  state: () => ({ viewport: initialViewport, selected: null, selectedIds: [], connectionView: {} }),
  live: ["viewport", "connectionView"],
  api(context) {
    const { element, options, store } = context;
    const viewport = createViewport(context, { key: "viewport", surface: () => element("frame") });
    let stopDrag: (() => void) | undefined;
    let previewElement: HTMLElement | undefined;
    let previewingConnectedNode = false;
    let translated: HTMLElement[] = [];
    let strokePreview: SVGPathElement | undefined;
    let previous = options();

    function clearTranslated() {
      for (const el of translated) {
        el.style.removeProperty("translate");
        el.removeAttribute("data-draw-preview");
      }
      translated = [];
      if (store.get().connectionView.nodeOffsets) writeConnections({ nodeOffsets: undefined });
    }

    function clearPreview() {
      clearTranslated();
      strokePreview?.ownerSVGElement?.remove();
      strokePreview = undefined;
      if (!previewElement) return;
      previewElement.style.removeProperty("translate");
      previewElement.style.removeProperty("--draw-preview-width");
      previewElement.style.removeProperty("--draw-preview-height");
      previewElement.removeAttribute("data-draw-preview");
      if (previewingConnectedNode) writeConnections({ nodePreview: undefined, nodeOffsets: undefined });
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
        store.set({ selected: null, selectedIds: [], viewport: initialViewport, connectionView: {} });
        next.onSelectionChange?.([]);
      }
      previous = next;
    });

    function writeConnections(patch: Partial<ConnectionViewState>) {
      store.set({ connectionView: { ...store.get().connectionView, ...patch } });
    }
    function applySelection(ids: readonly string[]) {
      const snapshot = options().documentController.getSnapshot();
      const primary = [...ids].reverse().find((id) => snapshot.nodes.some((node) => node.id === id) ||
        snapshot.groups?.some((group) => group.id === id)) ?? null;
      const current = store.get().selectedIds;
      const changed = store.get().selected !== primary || current.length !== ids.length ||
        current.some((id, index) => id !== ids[index]);
      if (changed) {
        store.set({ selected: primary, selectedIds: ids });
        options().onSelectionChange?.(ids);
      }
      const edgeIds = new Set(snapshot.connections?.map((edge) => edge.id));
      const marked = ids.filter((id) => edgeIds.has(id));
      const onlyConnection = ids.length === 1 && marked.length === 1 ? marked[0] : undefined;
      const view = store.get().connectionView;
      const previousMarked = view.selectedIds ?? [];
      const sameMarked = previousMarked.length === marked.length && previousMarked.every((id, index) => id === marked[index]);
      if (!view.pending && !view.draft && (view.selected !== onlyConnection || !!view.port || !sameMarked)) {
        writeConnections({ selected: onlyConnection, port: undefined, selectedIds: marked.length ? marked : undefined });
      }
    }

    function previewTranslation(offset: Point, nodeIds: readonly string[], groupIds: readonly string[]) {
      if (previewElement) {
        previewElement.style.removeProperty("translate");
        previewElement.style.removeProperty("--draw-preview-width");
        previewElement.style.removeProperty("--draw-preview-height");
        previewElement.removeAttribute("data-draw-preview");
        previewElement = undefined;
      }
      const next: HTMLElement[] = [];
      const apply = (el: HTMLElement | undefined) => {
        if (!el) return;
        el.setAttribute("data-draw-preview", "");
        el.style.translate = `${offset.x}px ${offset.y}px`;
        next.push(el);
      };
      for (const id of nodeIds) apply(element("node", id));
      for (const id of groupIds) apply(element("group", id));
      for (const el of translated) {
        if (!next.includes(el)) {
          el.style.removeProperty("translate");
          el.removeAttribute("data-draw-preview");
        }
      }
      translated = next;
      const offsets: Record<string, Point> = {};
      for (const id of nodeIds) offsets[id] = offset;
      writeConnections({ nodePreview: undefined, nodeOffsets: offsets });
      previewingConnectedNode = nodeIds.length > 0;
    }

    function memberIds(ids: readonly string[]) {
      const snapshot = toolContext.getSnapshot();
      const nodes = new Set(snapshot.nodes.map((node) => node.id));
      const groups = new Set(snapshot.groups?.map((group) => group.id));
      return ids.filter((id) => nodes.has(id) || groups.has(id));
    }

    function groupSelection() {
      const members = memberIds(store.get().selectedIds);
      if (members.length < 2) return;
      const before = new Set(toolContext.getSnapshot().groups?.map((group) => group.id));
      if (!toolContext.commands.group(members)) return;
      const created = toolContext.getSnapshot().groups?.find((group) => !before.has(group.id));
      if (created) applySelection([created.id]);
      const root = element("root");
      if (root) announce("Grouped", { doc: root.ownerDocument });
    }

    function ungroupSelection() {
      const snapshot = toolContext.getSnapshot();
      const ids = store.get().selectedIds;
      const selectedGroup = [...ids].reverse().find((id) => snapshot.groups?.some((group) => group.id === id));
      const members = memberIds(ids);
      const parent = members.length
        ? snapshot.groups?.find((group) => members.every((id) => group.memberIds.includes(id)))
        : undefined;
      const target = selectedGroup ?? parent?.id;
      const group = target ? snapshot.groups?.find((candidate) => candidate.id === target) : undefined;
      if (!group || !toolContext.commands.ungroup(group.id)) return;
      const next = toolContext.getSnapshot();
      applySelection(group.memberIds.filter((id) => next.nodes.some((node) => node.id === id) ||
        next.groups?.some((candidate) => candidate.id === id)));
      const root = element("root");
      if (root) announce("Ungrouped", { doc: root.ownerDocument });
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
        applySelection(id ? [id] : []);
      },
      toggleSelect(id) {
        const current = store.get().selectedIds;
        applySelection(current.includes(id) ? current.filter((candidate) => candidate !== id) : [...current, id]);
      },
      selectedIds: () => store.get().selectedIds,
      replaceSelection: (ids) => applySelection(ids),
      startPan: viewport.pointerdown,
      previewNode(id, { offset, size }) {
        if (translated.length) clearTranslated();
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
        if (previewingConnectedNode) writeConnections({ nodePreview: { id, offset, size }, nodeOffsets: undefined });
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

    function moveHandleNode(target: Element) {
      const id = target.closest("[data-draw-move]")?.getAttribute("data-draw-move");
      if (!id) return;
      return toolContext.getSnapshot().nodes.find((node) => node.id === id);
    }
    function groupMoveId(target: Element) {
      return target.closest("[data-draw-group-move]")?.getAttribute("data-draw-group-move") ?? undefined;
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
      revealBounds(node.bounds);
    }
    function revealBounds(bounds: { x: number; y: number; width: number; height: number }) {
      viewport.reveal({ left: bounds.x, top: bounds.y, right: bounds.x + bounds.width, bottom: bounds.y + bounds.height }, { padding: 16 });
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
        if (event.altKey) return;
        const lower = key.toLowerCase();
        if (lower === "z") {
          event.preventDefault();
          connectionEditing.cancelKeyboard();
          if (event.shiftKey) commands.redo();
          else commands.undo();
          return;
        }
        if (lower === "g" && !event.repeat) {
          event.preventDefault();
          connectionEditing.cancelKeyboard();
          if (event.shiftKey) ungroupSelection();
          else groupSelection();
          return;
        }
        return;
      }
      const tool = options().tool;
      if (tool?.keyDown?.(toolContext, event) || viewport.keydown(event)) {
        event.preventDefault();
        return;
      }
      if (event.altKey) return;
      if (!event.repeat && (key === "g" || key === "G")) {
        event.preventDefault();
        if (event.shiftKey || key === "G") ungroupSelection();
        else groupSelection();
        return;
      }
      if (key === "Escape") {
        toolContext.select(null);
        return;
      }
      const snapshot = toolContext.getSnapshot();
      const { connections } = snapshot;
      const { selected } = store.get();
      const selectedConnection = store.get().connectionView.selected;
      const items = snapshot.nodes.map((node) => ({ id: node.id, bounds: node.bounds, label: nodeLabel(node) }));
      for (const group of snapshot.groups ?? []) {
        const bounds = getGroupBounds(snapshot, group.id);
        if (bounds) items.push({ id: group.id, bounds, label: `Group ${group.id}` });
      }
      const index = items.findIndex(({ id }) => id === selected);
      if (tool === selectTool && (key === "PageUp" || key === "PageDown") && connections?.length) {
        event.preventDefault();
        const connectionIndex = connections.findIndex(({ id }) => id === selectedConnection);
        const step = key === "PageDown" ? 1 : -1;
        const edge = connections[connectionIndex < 0 ? (step > 0 ? 0 : connections.length - 1) : (connectionIndex + step + connections.length) % connections.length];
        if (event.shiftKey) toolContext.toggleSelect(edge.id);
        else toolContext.replaceSelection([edge.id]);
        const kept = store.get().selectedIds.includes(edge.id);
        if (kept) writeConnections({ selected: edge.id, port: undefined });
        else if (store.get().connectionView.selected === edge.id) writeConnections({ selected: undefined, port: undefined });
        const source = snapshot.nodes.find((node) => node.id === edge.source.nodeId);
        const target = snapshot.nodes.find((node) => node.id === edge.target.nodeId);
        if (source && target) announce(`Connection from ${nodeLabel(source)} to ${nodeLabel(target)} ${kept ? "selected" : "deselected"}`, { doc: root.ownerDocument });
      } else if ((key === "[" || key === "]" || key === "{" || key === "}") && items.length) {
        event.preventDefault();
        const step = key === "]" || key === "}" ? 1 : -1;
        const item = items[index < 0 ? (step > 0 ? 0 : items.length - 1) : (index + step + items.length) % items.length];
        if (event.shiftKey || key === "{" || key === "}") toolContext.toggleSelect(item.id);
        else toolContext.select(item.id);
        revealBounds(item.bounds);
        announce(`${item.label} selected`, { doc: root.ownerDocument });
      } else if (index < 0 && selectedConnection !== undefined && connections?.some(({ id }) => id === selectedConnection) &&
                 (key === "Backspace" || key === "Delete")) {
        event.preventDefault();
        commands.deleteConnection(selectedConnection);
        applySelection(store.get().selectedIds.filter((id) => id !== selectedConnection));
      } else if (index >= 0 && (key === "Backspace" || key === "Delete")) {
        event.preventDefault();
        commands.deleteNode(items[index].id);
        applySelection(store.get().selectedIds.filter((id) => id !== items[index].id));
      } else if (arrows[key] && (index >= 0 || tool === panTool)) {
        event.preventDefault();
        const { x, y } = arrows[key];
        if (tool === panTool) viewport.panBy(-x * 40, -y * 40);
        else {
          const { id, bounds } = items[index];
          const step = event.shiftKey ? 10 : 1;
          if (commands.moveNode(id, { x: bounds.x + x * step, y: bounds.y + y * step })) {
            const moved = toolContext.getSnapshot();
            const node = moved.nodes.find((candidate) => candidate.id === id);
            const groupBounds = node ? undefined : getGroupBounds(moved, id);
            if (node) reveal(node);
            else if (groupBounds) revealBounds(groupBounds);
          }
        }
      }
    }

    return {
      keyDown,
      click(event: MouseEvent, root: HTMLElement) {
        if (event.detail !== 0 || stopDrag || options().tool !== selectTool) return;
        const target = targetInCanvas(event.target, root);
        const node = target && moveHandleNode(target);
        if (node) {
          toolContext.select(node.id);
          root.focus({ preventScroll: true });
          reveal(node);
          return;
        }
        const groupId = target ? groupMoveId(target) : undefined;
        if (!groupId) return;
        toolContext.select(groupId);
        root.focus({ preventScroll: true });
        const bounds = getGroupBounds(toolContext.getSnapshot(), groupId);
        if (bounds) revealBounds(bounds);
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
        const groupId = tool === selectTool ? groupMoveId(target) : undefined;
        if (groupId) {
          event.preventDefault();
          if (event.shiftKey) {
            toolContext.toggleSelect(groupId);
            return;
          }
          toolContext.select(groupId);
          const start = viewport.toCanvas(event.clientX, event.clientY);
          const origin = getGroupBounds(toolContext.getSnapshot(), groupId);
          const nodeIds = descendantNodeIds(toolContext.getSnapshot(), groupId);
          const groupIds = [groupId, ...descendantGroupIds(toolContext.getSnapshot(), groupId)];
          const groupGesture = {
            preview(client: Point) {
              if (!origin) return;
              const point = viewport.toCanvas(client.x, client.y);
              previewTranslation({ x: point.x - start.x, y: point.y - start.y }, nodeIds, groupIds);
            },
            commit(client: Point) {
              if (!origin || !toolContext.getSnapshot().groups?.some((group) => group.id === groupId)) return;
              const point = viewport.toCanvas(client.x, client.y);
              toolContext.commands.moveNode(groupId, { x: origin.x + point.x - start.x, y: origin.y + point.y - start.y });
            },
          };
          stopDrag = bindDrag(root, event, {
            cancelOnEscape: true,
            onMove: ({ x, y }) => groupGesture.preview({ x, y }),
            onEnd(end, canceled) {
              stopDrag = undefined;
              clearPreview();
              connectionEditing.clearDraft();
              if (!canceled) groupGesture.commit({ x: end.clientX, y: end.clientY });
            },
          });
          return;
        }
        const moveNode = tool === selectTool ? moveHandleNode(target) : undefined;
        if (moveNode && event.shiftKey) {
          event.preventDefault();
          toolContext.toggleSelect(moveNode.id);
          return;
        }
        if (moveNode) toolContext.select(moveNode.id);
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
      attrs: (state, { key }) => ({ "data-selected": state.selectedIds.includes(key) ? "" : undefined }),
    }),
    group: slot<{ value: string }>({
      role: "group",
      props: { value: "string" },
      attrs: (state, { key }) => ({
        "data-selected": state.selectedIds.includes(key) ? "" : undefined,
        "data-draw-group": key,
      }),
    }),
  }),
  agent: { actions: [] },
});
