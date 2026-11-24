import type { DrawCommands, DrawDocument, DrawNode, Point, Size } from "./core.js";

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
};

export type ToolGesture = {
  preview?(client: Point): void;
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

export const selectTool: CanvasTool = {
  id: "select",
  pointerDown(context, event) {
    const start = context.toCanvas({ x: event.clientX, y: event.clientY });
    const node = context.hitTest(start);
    context.select(node?.id ?? null);
    if (!node) return;
    return boundsGesture(context, node, start, false);
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
