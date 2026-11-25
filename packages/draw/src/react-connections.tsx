import { memo, useMemo, type ReactNode } from "react";
import type { DrawConnection, DrawDocument, DrawNode } from "./core.js";
import type { ConnectionViewState } from "./connection-editing.js";
import {
  connectionArrowheadTransform, defaultArrowheadPath, getConnectionGeometry, nodeCenter, portPosition,
  type ConnectionGeometry, type ConnectionGeometryOptions,
} from "./connections.js";

export type ConnectionRenderOptions = {
  renderConnectionLine?: (connection: DrawConnection, geometry: ConnectionGeometry) => ReactNode;
  renderArrowhead?: (connection: DrawConnection, geometry: ConnectionGeometry) => ReactNode;
};

type ConnectionsProps = ConnectionRenderOptions & ConnectionGeometryOptions;

const ConnectionShape = memo(function ConnectionShape({ connection, source, target, selected, getPorts, getConnectionPath,
  renderConnectionLine, renderArrowhead }: ConnectionsProps & {
  connection: DrawConnection; source?: DrawNode; target?: DrawNode; selected: boolean;
}) {
  const geometry = getConnectionGeometry(connection, (id) => source?.id === id ? source : target?.id === id ? target : undefined,
    { getPorts, getConnectionPath });
  if (!geometry) return null;
  return (
    <g className="draw-connection" data-selected={selected ? "" : undefined}>
      {renderConnectionLine
        ? renderConnectionLine(connection, geometry)
        : <path className="draw-connection-line" d={geometry.path} />}
      {renderArrowhead
        ? renderArrowhead(connection, geometry)
        : <path className="draw-arrowhead" d={defaultArrowheadPath} transform={connectionArrowheadTransform(geometry.arrowhead)} />}
    </g>
  );
});

const PortMarkers = memo(function PortMarkers({ nodes, getPorts, port }: {
  nodes: readonly DrawNode[];
  getPorts: ConnectionGeometryOptions["getPorts"];
  port: ConnectionViewState["port"];
}) {
  return getPorts ? nodes.map((node) => (
    <g key={node.id}>
      {getPorts(node).map((candidate) => {
        const { x, y } = portPosition(node, candidate);
        const active = node.id === port?.nodeId && candidate.id === port.portId;
        return <circle key={candidate.id} className="draw-port" cx={x} cy={y} r={active ? 6 : 4} data-active={active ? "" : undefined} />;
      })}
    </g>
  )) : null;
});

export function ConnectionLayers({ document, view, connecting, editable, getPorts, getConnectionPath, renderConnectionLine,
  renderArrowhead }: ConnectionsProps & {
  document: DrawDocument; view: ConnectionViewState; connecting: boolean; editable: boolean;
}) {
  const hasConnections = !!document.connections?.length;
  const nodes = useMemo(() => hasConnections || connecting ? new Map(document.nodes.map((node) => [node.id, node])) : undefined,
    [document.nodes, hasConnections, connecting]);
  const getNode = (id: string) => {
    const node = nodes?.get(id);
    if (!node) return;
    const offset = view.nodeOffsets?.[id] ?? (view.nodePreview?.id === id ? view.nodePreview.offset : undefined);
    const size = view.nodePreview?.id === id ? view.nodePreview.size : undefined;
    if (!offset && !size) return node;
    return {
      ...node,
      bounds: {
        x: node.bounds.x + (offset?.x ?? 0),
        y: node.bounds.y + (offset?.y ?? 0),
        width: size?.width ?? node.bounds.width,
        height: size?.height ?? node.bounds.height,
      },
    };
  };
  const marked = new Set(view.selectedIds ?? (view.selected ? [view.selected] : []));
  const selected = editable && document.connections?.find(({ id }) => id === view.selected);
  const selectedGeometry = selected && !view.draft && getConnectionGeometry(selected, getNode, { getPorts, getConnectionPath });
  const pending = connecting && view.pending;
  const pendingNode = pending && getNode(pending.nodeId);
  const pendingPort = pending && pendingNode && pending.portId && getPorts?.(pendingNode).find(({ id }) => id === pending.portId);
  const pendingPosition = pendingNode && (pendingPort ? portPosition(pendingNode, pendingPort) : nodeCenter(pendingNode.bounds));
  return (
    <>
      {hasConnections && (
        <svg className="draw-connection-layer" width="1" height="1" aria-hidden="true">
          {document.connections?.map((connection) => connection.id !== view.draft?.replacing && (
            <ConnectionShape key={connection.id} connection={connection} source={getNode(connection.source.nodeId)}
              target={getNode(connection.target.nodeId)} selected={marked.has(connection.id)}
              getPorts={getPorts} getConnectionPath={getConnectionPath} renderConnectionLine={renderConnectionLine} renderArrowhead={renderArrowhead} />
          ))}
        </svg>
      )}
      {(connecting || selectedGeometry || view.draft) && (
        <svg className="draw-connection-overlay" width="1" height="1" aria-hidden="true">
          {connecting && <PortMarkers nodes={document.nodes} getPorts={getPorts} port={view.port} />}
          {pendingPosition && <circle className="draw-port" data-active="" cx={pendingPosition.x} cy={pendingPosition.y} r="7" />}
          {selectedGeometry && <>
            <circle className="draw-connection-handle" cx={selectedGeometry.source.x} cy={selectedGeometry.source.y} r="6" />
            <circle className="draw-connection-handle" cx={selectedGeometry.target.x} cy={selectedGeometry.target.y} r="6" />
          </>}
          {view.draft && <path className="draw-connection-draft" d={view.draft.path} />}
        </svg>
      )}
    </>
  );
}
