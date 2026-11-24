import type { DrawCommands, DrawDocument, DrawNode, Point, Size } from "./core.js";
import { createStrokeNode } from "./stroke.js";

export type ToolContext = {
  readonly commands: DrawCommands;
  getSnapshot(): DrawDocument;
  toCanvas(client: Point): Point;
  toClient(canvas: Point): Point;
  center(): Point;
  hitTest(canvas: Point): DrawNode | undefined;
  select(id: string | null): void;
  startPan(event: PointerEvent): void;
  previewNode(id: string, preview: { offset?: Point; size?: Size }): void;
  readonly connectionEditing?: {
    pointerDown(event: PointerEvent): ToolGesture | void;
    keyDown(event: KeyboardEvent): boolean;
    handlePointerDown(point: Point): ToolGesture | undefined;
    selectAt(point: Point): void;
  };
  previewStroke?(path: string): void;
};

export type ToolGesture = {
  preview?(client: Point, event?: PointerEvent): void;
  commit(client: Point): void;
};

export type CanvasTool = {
  readonly id: string;
  pointerDown?(context: ToolContext, event: PointerEvent): ToolGesture | void;
  keyDown?(context: ToolContext, event: KeyboardEvent): boolean;
};

export const panTool: CanvasTool = {
  id: "pan",
  pointerDown: (context, event) => context.startPan(event),
};

export const connectTool: CanvasTool = {
  id: "connect",
  pointerDown: (context, event) => context.connectionEditing?.pointerDown(event),
  keyDown: (context, event) => context.connectionEditing?.keyDown(event) ?? false,
};

export const selectTool: CanvasTool = {
  id: "select",
  pointerDown(context, event) {
    const start = context.toCanvas({ x: event.clientX, y: event.clientY });
    const reconnect = context.connectionEditing?.handlePointerDown(start);
    if (reconnect) return reconnect;
    const node = context.hitTest(start);
    context.select(node?.id ?? null);
    if (!node) return context.connectionEditing?.selectAt(start);
    return boundsGesture(context, node, start, false);
  },
};

let strokeSequence = 0;

export const freehandTool: CanvasTool = {
  id: "freehand",
  pointerDown(context, event) {
    const first = context.toCanvas({ x: event.clientX, y: event.clientY });
    const points = [first];
    let path = `M${first.x} ${first.y}`;
    context.previewStroke?.(`${path}L${first.x} ${first.y}`);

    function sample(client: Point) {
      const point = context.toCanvas(client);
      const last = points[points.length - 1];
      if (point.x === last.x && point.y === last.y) return;
      points.push(point);
      path += `L${point.x} ${point.y}`;
    }

    return {
      preview(client, move) {
        const count = points.length;
        for (const event of move?.getCoalescedEvents?.() ?? []) {
          sample({ x: event.clientX, y: event.clientY });
        }
        sample(client);
        if (points.length !== count) context.previewStroke?.(path);
      },
      commit(client) {
        sample(client);
        const { nodes } = context.getSnapshot();
        let id: string;
        do id = `stroke-${++strokeSequence}`;
        while (nodes.some((node) => node.id === id));
        if (context.commands.insertNode(createStrokeNode(id, points))) context.select(id);
      },
    };
  },
};

export function insertNodeTool(createNode: (at: Point) => DrawNode): CanvasTool {
  function insert(context: ToolContext, at: Point) {
    const node = createNode(at);
    if (context.commands.insertNode(node)) context.select(node.id);
  }

  return {
    id: "insert-node",
    pointerDown(context) {
      return { commit: (client) => insert(context, context.toCanvas(client)) };
    },
    keyDown(context, event) {
      if (event.key !== "Enter" || event.repeat) return false;
      insert(context, context.center());
      return true;
    },
  };
}

export function boundsGesture(context: ToolContext, node: DrawNode, start: Point, resize: boolean): ToolGesture {
  const size = (dx: number, dy: number) => ({
    width: Math.max(Math.min(24, node.bounds.width), node.bounds.width + dx),
    height: Math.max(Math.min(24, node.bounds.height), node.bounds.height + dy),
  });
  const position = (dx: number, dy: number) => ({ x: node.bounds.x + dx, y: node.bounds.y + dy });

  return {
    preview(client) {
      const { x, y } = context.toCanvas(client);
      const dx = x - start.x;
      const dy = y - start.y;
      context.previewNode(node.id, resize ? { size: size(dx, dy) } : { offset: { x: dx, y: dy } });
    },
    commit(client) {
      if (!context.getSnapshot().nodes.includes(node)) return;
      const { x, y } = context.toCanvas(client);
      if (resize) context.commands.resizeNode(node.id, size(x - start.x, y - start.y));
      else context.commands.moveNode(node.id, position(x - start.x, y - start.y));
    },
  };
}
