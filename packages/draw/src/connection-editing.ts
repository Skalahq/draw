import type { ConnectionEnd, ConnectionEndpoint, DrawConnection, DrawDocument, DrawNode, Point, Size } from "./core.js";
import { boundaryPosition, getConnectionGeometry, hitTestConnection, portPosition, type ConnectionGeometryOptions } from "./connections.js";
import type { ToolContext, ToolGesture } from "./tools.js";

export type ConnectionViewState = Readonly<{
  selected?: string;
  port?: ConnectionEndpoint;
  pending?: ConnectionEndpoint;
  draft?: { path: string; replacing?: string };
  nodePreview?: { id: string; offset?: Point; size?: Size };
  nodeOffsets?: Readonly<Record<string, Point>>;
  selectedIds?: readonly string[];
}>;

type Reconnect = { connection: DrawConnection; end: ConnectionEnd };
type Pending = { fixed: ConnectionEndpoint; reconnect?: Reconnect };
const ends = ["source", "target"] as const;

export function createConnectionEditing({ context, read, write, options, zoom, selectedNode, chooseNode, nodeLabel, announce }: {
  context: ToolContext;
  read(): ConnectionViewState;
  write(patch: Partial<ConnectionViewState>): void;
  options(): ConnectionGeometryOptions;
  zoom(): number;
  selectedNode(): DrawNode | undefined;
  chooseNode(node: DrawNode): void;
  nodeLabel(node: DrawNode): string;
  announce(message: string): void;
}) {
  let keyboard: Pending | undefined;
  let sequence = 0;

  function getNode(id: string) {
    return context.getSnapshot().nodes.find((node) => node.id === id);
  }

  function edgeById(id: string | undefined) {
    return id === undefined ? undefined : context.getSnapshot().connections?.find((edge) => edge.id === id);
  }

  function clearDraft() {
    if (read().draft) write({ draft: undefined });
  }

  function cancelKeyboard() {
    if (!keyboard) return false;
    keyboard = undefined;
    write({ pending: undefined });
    return true;
  }

  function select(id?: string) {
    if (id !== undefined) context.replaceSelection([id]);
    if (read().selected !== id || read().port) write({ selected: id, port: undefined });
  }

  function nearby(point: Point, candidate: Point, radius: number) {
    return (point.x - candidate.x) ** 2 + (point.y - candidate.y) ** 2 <= radius * radius;
  }

  function hitEndpoint(point: Point): ConnectionEndpoint | undefined {
    const { nodes } = context.getSnapshot();
    const node = context.hitTest(point);
    const getPorts = options().getPorts;
    if (getPorts) {
      const radius = 10 / zoom();
      // A visible port on the topmost hit node takes priority over an underlying node's ports.
      for (let i = nodes.length - 1; i >= 0; i--) {
        const candidate = nodes[i];
        const bounds = candidate.bounds;
        if ((node && candidate !== node) || point.x < bounds.x - radius || point.x > bounds.x + bounds.width + radius ||
            point.y < bounds.y - radius || point.y > bounds.y + bounds.height + radius) continue;
        for (const port of getPorts(candidate)) {
          if (nearby(point, portPosition(candidate, port), radius)) return { nodeId: candidate.id, portId: port.id };
        }
      }
    }
    if (node) return { nodeId: node.id };
  }

  function geometryFor(connection: DrawConnection, doc: DrawDocument) {
    return getConnectionGeometry(connection, (id) => doc.nodes.find((node) => node.id === id), options());
  }

  function selectAt(point: Point, additive = false): void {
    const doc = context.getSnapshot();
    if (!doc.connections?.length) {
      if (!additive) select();
      return;
    }
    const nodes = new Map(doc.nodes.map((node) => [node.id, node]));
    const geometryOptions = options();
    const tolerance = 7 / zoom();
    for (let i = doc.connections.length - 1; i >= 0; i--) {
      const edge = doc.connections[i];
      const geometry = getConnectionGeometry(edge, (id) => nodes.get(id), geometryOptions);
      if (geometry && hitTestConnection(geometry, point, tolerance)) {
        if (additive) {
          const already = context.selectedIds().includes(edge.id);
          context.toggleSelect(edge.id);
          if (!already) write({ selected: edge.id, port: undefined });
          else if (read().selected === edge.id) write({ selected: undefined, port: undefined });
          return;
        }
        select(edge.id);
        return;
      }
    }
    if (!additive) select();
  }

  function candidateConnection({ fixed, reconnect }: Pending, endpoint: ConnectionEndpoint): DrawConnection {
    return reconnect ? { ...reconnect.connection, [reconnect.end]: endpoint }
      : { id: `connection-${sequence + 1}`, source: fixed, target: endpoint };
  }

  function finish(pending: Pending, endpoint: ConnectionEndpoint): string | undefined {
    const { fixed, reconnect } = pending;
    if (reconnect) {
      if (edgeById(reconnect.connection.id) !== reconnect.connection) return;
      if (context.commands.reconnectConnection(reconnect.connection.id, reconnect.end, endpoint)) return reconnect.connection.id;
      return;
    }
    if (endpoint.nodeId === fixed.nodeId && endpoint.portId === fixed.portId) return;
    let connection: DrawConnection;
    do {
      connection = candidateConnection(pending, endpoint);
      sequence++;
    } while (edgeById(connection.id));
    if (context.commands.insertConnection(connection)) return connection.id;
  }

  function gesture(pending: Pending): ToolGesture {
    return {
      preview(client) {
        const point = context.toCanvas(client);
        const endpoint = hitEndpoint(point);
        const { fixed, reconnect } = pending;
        const geometry = endpoint && (endpoint.nodeId !== fixed.nodeId || endpoint.portId !== fixed.portId || reconnect)
          ? geometryFor(candidateConnection(pending, endpoint), context.getSnapshot()) : undefined;
        if (geometry) {
          write({ draft: { path: geometry.path, replacing: reconnect?.connection.id } });
          return;
        }
        const node = getNode(fixed.nodeId);
        if (!node) return clearDraft();
        const port = fixed.portId && options().getPorts?.(node).find(({ id }) => id === fixed.portId);
        const anchor = port ? portPosition(node, port) : boundaryPosition(node.bounds, point);
        write({ draft: { path: `M ${anchor.x} ${anchor.y} L ${point.x} ${point.y}`, replacing: reconnect?.connection.id } });
      },
      commit(client) {
        const endpoint = hitEndpoint(context.toCanvas(client));
        if (endpoint) {
          const id = finish(pending, endpoint);
          if (id !== undefined) select(id);
        }
      },
    };
  }

  function handlePointerDown(point: Point): ToolGesture | undefined {
    const connection = edgeById(read().selected);
    if (!connection) return;
    const geometry = geometryFor(connection, context.getSnapshot());
    if (!geometry) return;
    const radius = 10 / zoom();
    const sourceDistance = Math.hypot(point.x - geometry.source.x, point.y - geometry.source.y);
    const targetDistance = Math.hypot(point.x - geometry.target.x, point.y - geometry.target.y);
    if (Math.min(sourceDistance, targetDistance) > radius) return;
    const end = sourceDistance < targetDistance ? "source" : "target";
    return gesture({ fixed: connection[end === "source" ? "target" : "source"], reconnect: { connection, end } });
  }

  function pointerDown(event: PointerEvent) {
    cancelKeyboard();
    const point = context.toCanvas({ x: event.clientX, y: event.clientY });
    const reconnect = handlePointerDown(point);
    if (reconnect) return reconnect;
    const endpoint = hitEndpoint(point);
    if (endpoint) {
      context.select(endpoint.nodeId);
      return gesture({ fixed: endpoint });
    }
    context.select(null);
    selectAt(point);
  }

  function keyDown(event: KeyboardEvent): boolean {
    if (event.altKey || event.shiftKey) return false;
    const { key } = event;
    if (key === "Escape" && cancelKeyboard()) {
      announce("Connection edit canceled");
      return true;
    }
    if (event.repeat && (key === "Enter" || key === "1" || key === "2")) return true;
    const node = selectedNode();
    if ((key === "." || key === ",") && node) {
      const ports = options().getPorts?.(node) ?? [];
      const old = read().port;
      const index = old?.nodeId === node.id ? ports.findIndex(({ id }) => id === old.portId) : -1;
      const next = (index + 1 + (key === "." ? 1 : ports.length) ) % (ports.length + 1) - 1;
      const port = ports[next];
      write({ port: port && { nodeId: node.id, portId: port.id } });
      announce(`${nodeLabel(node)}, ${port ? port.label ?? port.id : "boundary"}`);
      return true;
    }
    if (key === "Enter" && node) {
      const previewPort = read().port;
      const port = previewPort?.nodeId === node.id && options().getPorts?.(node).some(({ id }) => id === previewPort.portId);
      const endpoint = port ? previewPort : { nodeId: node.id };
      if (keyboard) {
        const id = finish(keyboard, endpoint);
        if (id !== undefined) {
          select(id);
          announce(keyboard.reconnect ? "Connection reconnected" : "Connection added");
          cancelKeyboard();
        }
      } else {
        keyboard = { fixed: endpoint };
        write({ pending: endpoint });
        announce(`From ${nodeLabel(node)}, ${endpoint.portId ?? "boundary"}. Choose a destination and press Enter.`);
      }
      return true;
    }
    if (key === "PageUp" || key === "PageDown") {
      const { connections } = context.getSnapshot();
      if (!connections?.length) return false;
      cancelKeyboard();
      const index = connections.findIndex(({ id }) => id === read().selected);
      const step = key === "PageDown" ? 1 : -1;
      const edge = connections[index < 0 ? (step > 0 ? 0 : connections.length - 1) : (index + step + connections.length) % connections.length];
      select(edge.id);
      const source = getNode(edge.source.nodeId);
      const target = getNode(edge.target.nodeId);
      if (source && target) announce(`Connection from ${nodeLabel(source)} to ${nodeLabel(target)} selected`);
      return true;
    }
    const end = key === "1" ? ends[0] : key === "2" ? ends[1] : undefined;
    const connection = end && edgeById(read().selected);
    if (end && connection) {
      const previous = connection[end];
      const currentNode = getNode(previous.nodeId);
      if (!currentNode) return false;
      keyboard = { fixed: connection[end === "source" ? "target" : "source"], reconnect: { connection, end } };
      chooseNode(currentNode);
      write({ pending: keyboard.fixed, port: previous.portId ? previous : undefined });
      announce(`Reconnect ${end}. Choose a node and press Enter.`);
      return true;
    }
    return false;
  }

  return { select, selectAt, cancelKeyboard, clearDraft, pointerDown, handlePointerDown, keyDown };
}
