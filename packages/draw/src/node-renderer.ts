import type { DrawNode, Size } from "./core.js";

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
