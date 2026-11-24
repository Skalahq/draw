import { expect, test, type Locator, type Page } from "@playwright/test";

const committed = (page: Page) => page.getByRole("status", { name: "Committed edits" });
const node = (page: Page, label: string) => page.getByRole("group", { name: label, exact: true });

async function box(locator: Locator) {
  await expect(locator).toBeVisible();
  const bounds = await locator.boundingBox();
  if (!bounds) throw new Error("Missing visible canvas geometry");
  return bounds;
}

test("canvas and host share history; keyboard users can insert, select, move and undo", async ({ page }) => {
  await page.goto("/");
  const canvas = page.getByRole("region", { name: "Drawing canvas" });
  await page.getByRole("button", { name: "Add note", exact: true }).click();
  await expect(node(page, "Note 1")).toBeVisible();
  const insert = page.getByRole("button", { name: "Insert note", exact: true });
  await expect(insert).toBeEnabled();
  await insert.focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await expect(node(page, "Note 2")).toBeVisible();
  await expect(committed(page)).toHaveText("2");

  await page.getByRole("button", { name: "Select", exact: true }).click();
  await expect(canvas).toBeFocused();
  await page.keyboard.press("[");
  const original = await box(node(page, "Note 1"));
  await page.keyboard.press("ArrowRight");
  await expect.poll(async () => (await box(node(page, "Note 1"))).x).toBe(original.x + 1);
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await box(node(page, "Note 1"))).x).toBe(original.x);
  await page.keyboard.press("Delete");
  await expect(node(page, "Note 1")).toHaveCount(0);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(node(page, "Note 1")).toBeVisible();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(node(page, "Note 2")).toHaveCount(0);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(node(page, "Note 1")).toHaveCount(0);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(node(page, "Note 1")).toBeVisible();
  await expect(committed(page)).toHaveText("9");
});

test("pointer previews cancel or commit once; pan and zoom preserve custom tool coordinates", async ({ page }) => {
  await page.goto("/");
  const canvas = page.getByRole("region", { name: "Drawing canvas" });
  await page.getByRole("button", { name: "Insert note", exact: true }).click();
  await canvas.click({ position: { x: 130, y: 120 } });
  const note = node(page, "Note 1");
  const original = await box(note);
  await page.getByRole("button", { name: "Select", exact: true }).click();
  const start = async () => {
    await page.mouse.move(original.x + 30, original.y + 25);
    await page.mouse.down();
    await page.mouse.move(original.x + 90, original.y + 65, { steps: 5 });
    await expect.poll(async () => (await box(note)).x).toBe(original.x + 60);
    await expect(committed(page)).toHaveText("1");
  };

  await start();
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect.poll(async () => (await box(note)).x).toBe(original.x);

  await start();
  await canvas.dispatchEvent("pointercancel", { pointerId: 1, pointerType: "mouse", bubbles: true });
  await page.mouse.up();
  await expect.poll(async () => (await box(note)).x).toBe(original.x);
  await expect(committed(page)).toHaveText("1");

  await start();
  await page.mouse.up();
  await expect(committed(page)).toHaveText("2");
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await box(note)).x).toBe(original.x);
  await page.keyboard.press("Control+Shift+z");
  await expect.poll(async () => (await box(note)).x).toBe(original.x + 60);

  const moved = await box(note);
  await page.mouse.move(moved.x + moved.width - 2, moved.y + moved.height - 2);
  await page.mouse.down();
  await page.mouse.move(moved.x + moved.width + 38, moved.y + moved.height + 28, { steps: 4 });
  await expect.poll(async () => (await box(note)).width).toBe(moved.width + 40);
  await expect(committed(page)).toHaveText("4");
  await page.mouse.up();
  await expect(committed(page)).toHaveText("5");
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await box(note)).width).toBe(moved.width);

  await page.getByRole("button", { name: "Pan", exact: true }).click();
  const frame = await box(canvas);
  await page.mouse.move(frame.x + 500, frame.y + 220);
  await page.mouse.down();
  await page.mouse.move(frame.x + 550, frame.y + 250, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => (await box(note)).x).toBe(moved.x + 50);
  await page.keyboard.press("+");
  await expect.poll(async () => (await box(note)).width).toBeGreaterThan(moved.width);
  await expect(committed(page)).toHaveText("6");

  await page.getByRole("button", { name: "Stamp marker", exact: true }).click();
  await page.mouse.click(frame.x + 600, frame.y + 300);
  const marker = await box(node(page, "Marker 2"));
  expect(Math.abs(marker.x + marker.width / 2 - (frame.x + 600))).toBeLessThan(1);
  expect(Math.abs(marker.y + marker.height / 2 - (frame.y + 300))).toBeLessThan(1);
  await expect(committed(page)).toHaveText("7");
});

test("a selected node's resize handle stays usable behind a later node", async ({ page }) => {
  await page.goto("/");
  const add = page.getByRole("button", { name: "Add note", exact: true });
  await add.click();
  await add.click();
  const first = node(page, "Note 1");
  const second = node(page, "Note 2");
  const before = await box(first);
  const overlapping = await box(second);
  await page.getByRole("button", { name: "Select", exact: true }).click();
  await page.keyboard.press("]");
  await page.mouse.move(before.x + before.width - 4, before.y + before.height - 4);
  await page.mouse.down();
  await page.mouse.move(before.x + before.width + 16, before.y + before.height + 16, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => (await box(first)).width).toBe(before.width + 20);
  expect(await box(second)).toEqual(overlapping);
});
