import { createDrawController, insertNodeTool, panTool, selectTool } from "@skalahq/draw/core";
import { mountDraw } from "@skalahq/draw/dom";
import "@skalahq/draw/styles.css";

let nextId = 0;
function note(point) {
  const id = ++nextId;
  return {
    id: `note-${id}`,
    type: "note",
    bounds: { ...point, width: 150, height: 72 },
    metadata: { label: `Note ${id}` },
  };
}

const first = createDrawController();
const second = createDrawController({
  version: 1,
  nodes: [{ id: "other", type: "note", bounds: { x: 25, y: 30, width: 150, height: 72 }, metadata: { label: "Other note" } }],
});
const host = document.querySelector("#drawing");
const edits = document.querySelector("#edits");
const insert = insertNodeTool(note);
let committed = 0;
for (const controller of [first, second]) {
  controller.subscribeCommitted(() => { edits.value = String(++committed); });
}

let options = {
  controller: first,
  tool: selectTool,
  ariaLabel: "Plain drawing",
  getNodeLabel: (node) => node.metadata.label,
};
let mounted = mountDraw(host, options);

function update(patch) {
  options = { ...options, ...patch };
  mounted?.update(patch);
}

function use(tool) {
  update({ tool });
  host.querySelector(".draw-canvas")?.focus();
}

const renderers = {
  note: {
    mount(container) {
      const input = container.ownerDocument.createElement("input");
      input.setAttribute("aria-label", "Node draft");
      container.append(input);
      return {
        update({ node }) { input.placeholder = node.metadata.label; },
        dispose() { input.remove(); },
      };
    },
  },
};

const onClick = (id, action) => document.getElementById(id).addEventListener("click", action);
onClick("add", () => first.commands.insertNode(note({ x: 40, y: 45 })));
onClick("insert", () => use(insert));
onClick("select", () => use(selectTool));
onClick("pan", () => use(panTool));
onClick("custom", () => update({ nodeRenderers: renderers }));
onClick("second", () => update({ controller: second, ariaLabel: "Second drawing", nodeRenderers: undefined }));
onClick("dispose", () => { mounted?.dispose(); mounted = undefined; });
onClick("remount", () => { mounted ??= mountDraw(host, options); });
