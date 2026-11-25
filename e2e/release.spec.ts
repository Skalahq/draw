import { expect, test, type Locator, type Page } from "@playwright/test";

const canvas = (page: Page) => page.getByRole("region", { name: "Drawing canvas" });
const stroke = (page: Page) => page.getByRole("group", { name: "Freehand stroke", exact: true });
const tool = (page: Page, name: string) => page.getByRole("button", { name, exact: true });

async function box(locator: Locator) {
  await expect(locator).toBeVisible();
  const bounds = await locator.boundingBox();
  if (!bounds) throw new Error("Missing visible geometry");
  return bounds;
}

async function drag(page: Page, x: number, y: number, dx: number, dy: number) {
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 8 });
  await page.mouse.up();
}

async function shiftClick(page: Page, x: number, y: number) {
  await page.keyboard.down("Shift");
  await page.mouse.click(x, y);
  await page.keyboard.up("Shift");
}

async function downloaded(page: Page, name: string) {
  const pending = page.waitForEvent("download");
  await tool(page, name).click();
  const file = await (await pending).path();
  if (!file) throw new Error(`Missing ${name} download`);
  return file;
}

test("integrated workflow canvas keeps React, Solid, ports, and custom arrows", async ({ page }) => {
  await page.goto("/workflow");
  const surface = page.getByRole("region", { name: "Workflow canvas" });
  const note = surface.getByRole("textbox", { name: "Note" });
  const react = surface.getByRole("group", { name: "React note" });
  await expect(page.getByRole("status", { name: "Live Solid nodes" })).toHaveText("1");
  const before = await box(react);
  await note.click();
  await note.pressSequentially("z");
  await note.press("ArrowLeft");
  const after = await box(react);
  expect(Math.round(after.x)).toBe(Math.round(before.x));
  expect(Math.round(after.y)).toBe(Math.round(before.y));
  await expect(page.locator("[data-arrow='review']")).toBeVisible();
  await expect(page.locator("[data-arrow='review-head']")).toBeVisible();
  await tool(page, "Connect").click();
  await expect(page.locator(".draw-port")).toHaveCount(2);
});

test("sketch nested groups, workspaces, JSON, and SVG/PNG share one delivery", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/sketch");
  const surface = await box(canvas(page));
  const origin = { x: Math.floor(surface.x + 180), y: Math.floor(surface.y + surface.height / 2) };
  await tool(page, "Freehand").click();
  await drag(page, origin.x - 70, origin.y, 50, 0);
  await drag(page, origin.x + 40, origin.y, 50, 0);
  await expect(stroke(page)).toHaveCount(2);

  await tool(page, "Select").click();
  const second = await box(stroke(page).nth(1));
  await stroke(page).nth(0).click();
  await shiftClick(page, second.x + second.width / 2, second.y + second.height / 2);
  await canvas(page).focus();
  await page.keyboard.press("g");
  await expect(page.getByRole("button", { name: "Move group group-1" })).toBeVisible();

  await tool(page, "Insert note").click();
  await page.mouse.click(surface.x + 36, surface.y + 36);
  const note = page.getByRole("group", { name: "Sketch note 1", exact: true });
  await expect(note).toBeVisible();
  await tool(page, "Select").click();
  await canvas(page).focus();
  await page.keyboard.press("}");
  await page.keyboard.press("g");
  const outer = page.getByRole("button", { name: "Move group group-2" });
  await expect(outer).toBeVisible();
  const beforeStroke = await box(stroke(page).nth(0));
  const beforeNote = await box(note);
  await canvas(page).focus();
  await page.keyboard.press("Shift+ArrowRight");
  expect((await box(stroke(page).nth(0))).x).toBeGreaterThan(beforeStroke.x + 4);
  expect((await box(note)).x).toBeGreaterThan(beforeNote.x + 4);

  await page.goto("/workspaces");
  await page.getByLabel("New workspace").fill("Release studio");
  await tool(page, "Create workspace").click();
  await page.getByLabel("New canvas").fill("Release A");
  await tool(page, "Create canvas").click();
  await tool(page, "Add note").click();
  await expect(page.getByRole("group", { name: "Note 1", exact: true })).toBeVisible();
  await page.getByLabel("New canvas").fill("Release B");
  await tool(page, "Create canvas").click();
  await page.reload();
  await tool(page, "Release A").click();
  await expect(page.getByRole("group", { name: "Note 1", exact: true })).toBeVisible();
  await tool(page, "Undo").click();
  await expect(page.getByRole("group", { name: "Note 1", exact: true })).toBeVisible();

  await page.goto("/json");
  await tool(page, "Add note").click();
  const jsonDownload = await downloaded(page, "Export JSON");
  const json = JSON.parse(await Bun.file(jsonDownload).text());
  expect(json.version).toBe(1);
  expect(json.nodes[0]).toMatchObject({ type: "note", metadata: { label: "Note" } });
  expect(json.camera).toBeUndefined();

  await page.goto("/export");
  const svgDownload = await downloaded(page, "Export SVG");
  const svg = await Bun.file(svgDownload).text();
  expect(svg).toContain("<svg");
  expect(svg).toContain("Field note");
  await expect(page.getByLabel("SVG dimensions")).not.toHaveText("Not exported");
  const pngDownload = await downloaded(page, "Export PNG");
  const png = new Uint8Array(await Bun.file(pngDownload).arrayBuffer());
  expect(png[0]).toBe(137);
  await expect(page.getByRole("img", { name: "Exported PNG preview" })).toBeVisible();
  await expect(page.getByLabel("Unsupported content")).not.toHaveText("Not exported");
});
