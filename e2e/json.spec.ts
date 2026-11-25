import { expect, test, type Page } from "@playwright/test";

async function importJson(page: Page, name: string, json: string) {
  const trigger = page.getByRole("button", { name: "Import JSON" });
  await expect(trigger).toBeEnabled();
  const picker = page.waitForEvent("filechooser");
  await trigger.press("Enter");
  await (await picker).setFiles({ name, mimeType: "application/json", buffer: Buffer.from(json) });
}

const canvas = (page: Page) => page.getByRole("region", { name: "Drawing canvas" });
const node = (page: Page, name: string) => canvas(page).getByRole("group", { name, exact: true });

async function boundsInCanvas(page: Page, name: string) {
  const frame = await canvas(page).boundingBox();
  const bounds = await node(page, name).boundingBox();
  if (!frame || !bounds) throw new Error("Missing visible drawing geometry");
  return { ...bounds, x: bounds.x - frame.x, y: bounds.y - frame.y };
}

const note = { id: "stable-note", type: "note", bounds: { x: 32, y: 44, width: 120, height: 60 }, metadata: { label: "Exported note" } };
const unregistered = {
  id: "foreign-1",
  type: "vendor:diagram",
  bounds: { x: 96, y: 84, width: 96, height: 48 },
  metadata: { model: { count: 3, values: [false, null, "preserved"] } },
};

test("a downloaded document opens in another canvas without inheriting editor state", async ({ page, context }) => {
  await page.goto("/json");
  await importJson(page, "drawing.json", JSON.stringify({ version: 1, nodes: [note, unregistered] }));
  await expect(node(page, "Exported note")).toBeVisible();
  await canvas(page).press("]");
  await canvas(page).press("ArrowRight");
  await canvas(page).press("+");
  await expect.poll(async () => (await node(page, "Exported note").boundingBox())?.width).toBeGreaterThan(120);

  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export JSON" }).press("Space");
  const download = await downloading;
  expect(download.suggestedFilename()).toBe("drawing.json");
  const json = await Bun.file(await download.path()).text();
  expect(JSON.parse(json)).toEqual({ version: 1, nodes: [{ ...note, bounds: { ...note.bounds, x: 33 } }, unregistered] });

  const target = await context.newPage();
  await target.goto("/json");
  const oldNote = { ...note, metadata: { label: "Old note" } };
  await importJson(target, "old.json", JSON.stringify({ version: 1, nodes: [oldNote] }));
  await expect(node(target, "Old note")).toBeVisible();
  await canvas(target).press("]");
  await canvas(target).press("ArrowRight");
  await canvas(target).press("+");
  await expect.poll(async () => (await node(target, "Old note").boundingBox())?.width).toBeGreaterThan(120);
  const selectedBounds = await boundsInCanvas(target, "Old note");
  await importJson(target, "invalid.json", '{"version":99,"nodes":[]}');
  const fileActions = target.getByRole("region", { name: "Editable document files" });
  await expect(fileActions.getByRole("alert")).toContainText("Unsupported Draw document version: 99");
  expect(await boundsInCanvas(target, "Old note")).toEqual(selectedBounds);
  await canvas(target).press("Delete");
  await expect(node(target, "Old note")).toHaveCount(0);
  await target.getByRole("button", { name: "Undo" }).click();
  await expect(node(target, "Old note")).toBeVisible();

  await importJson(target, download.suggestedFilename(), json);
  await expect(node(target, "Old note")).toHaveCount(0);
  await expect(node(target, "Exported note")).toBeVisible();
  await expect(node(target, "vendor:diagram")).toHaveText("vendor:diagram");
  await expect.poll(async () => (await node(target, "Exported note").boundingBox())?.width).toBe(120);
  await target.getByRole("button", { name: "Undo" }).click();
  await target.getByRole("button", { name: "Redo" }).click();
  await canvas(target).press("Delete");
  await expect(node(target, "Exported note")).toBeVisible();
  await expect(node(target, "vendor:diagram")).toBeVisible();

  await canvas(target).press("[");
  const original = await node(target, "vendor:diagram").boundingBox();
  await canvas(target).press("ArrowRight");
  await expect.poll(async () => (await node(target, "vendor:diagram").boundingBox())?.x).toBe((original?.x ?? 0) + 1);
});
