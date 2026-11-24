import { expect, test, type Locator, type Page } from "@playwright/test";

const canvasOf = (page: Page) => page.getByRole("region", { name: "Workflow canvas" });
const committed = (page: Page) => page.getByRole("status", { name: "Workflow edits" });
const path = (page: Page) => page.getByTestId("workflow-line");
const head = (page: Page) => page.getByTestId("workflow-head");

async function origin(canvas: Locator) {
  const world = canvas.locator(".draw-world");
  return world.evaluate((element) => {
    const { x, y } = element.getBoundingClientRect();
    return { x, y };
  });
}

test("draw and reconnect on the custom curve; Escape, pointer cancellation, and Undo keep atomic edits", async ({ page }) => {
  await page.goto("/connections");
  const canvas = canvasOf(page);
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  const base = await origin(canvas);
  const move = (x: number, y: number) => page.mouse.move(base.x + x, base.y + y);
  const press = (x: number, y: number) => page.mouse.click(base.x + x, base.y + y);
  async function drag(x: number, y: number, toX: number, toY: number) {
    await move(x, y);
    await page.mouse.down();
    await move(toX, toY);
    await page.mouse.up();
  }

  await drag(200, 188, 400, 188);
  await expect(path(page)).toHaveAttribute("d", "M 200 188 Q 400 108 400 188");
  await expect(head(page)).toHaveAttribute("transform", "translate(400 188) rotate(90)");
  await expect(committed(page)).toHaveText("1 edit");

  await press(700, 50);
  await press(350, 188);
  await expect(canvas.locator(".draw-connection-handle")).toHaveCount(0);
  await press(350, 148);
  await expect(canvas.locator(".draw-connection-handle")).toHaveCount(2);
  await move(400, 188);
  await page.mouse.down();
  await move(400, 418);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(path(page)).toHaveAttribute("d", "M 200 188 Q 400 108 400 188");
  await expect(committed(page)).toHaveText("1 edit");

  await move(400, 188);
  await page.mouse.down();
  await move(400, 418);
  await canvas.dispatchEvent("pointercancel", { pointerId: 1, pointerType: "mouse", isPrimary: true });
  await page.mouse.up();
  await expect(committed(page)).toHaveText("1 edit");
  await drag(400, 188, 400, 418);
  await expect(path(page)).toHaveAttribute("d", "M 200 188 Q 400 108 400 418");
  await expect(committed(page)).toHaveText("2 edits");
  await drag(200, 188, 450, 200);
  await expect(committed(page)).toHaveText("3 edits");
  await page.keyboard.press("Control+z");
  await expect(path(page)).toHaveAttribute("d", "M 200 188 Q 400 108 400 418");
  await page.keyboard.press("Control+z");
  await expect(path(page)).toHaveAttribute("d", "M 200 188 Q 400 108 400 188");
});

test("keyboard users choose ports and boundaries, move nodes, and restore incident connections", async ({ page }) => {
  await page.goto("/connections");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  const canvas = canvasOf(page);
  await expect(canvas).toBeFocused();
  await canvas.press("]");
  await canvas.press(".");
  await canvas.press("Enter");
  await canvas.press("]");
  await canvas.press("Enter");
  await expect(path(page)).toHaveAttribute("d", "M 200 188 Q 400 108 400 196");
  await page.getByRole("button", { name: "Hide named ports" }).click();
  await expect(path(page)).toHaveAttribute("d", "M 200 200 Q 400 120 400 200");
  await page.getByRole("button", { name: "Show named ports" }).click();
  await expect(path(page)).toHaveAttribute("d", "M 200 188 Q 400 108 400 196");
  await expect(committed(page)).toHaveText("1 edit");

  await page.getByRole("button", { name: "Select", exact: true }).click();
  await canvas.press("]");
  const original = await path(page).getAttribute("d");
  await canvas.press("Shift+ArrowRight");
  await expect(path(page)).not.toHaveAttribute("d", original!);
  await canvas.press("Delete");
  await expect(path(page)).toHaveCount(0);
  await canvas.press("Control+z");
  await expect(path(page)).toHaveCount(1);
  await canvas.press("Control+z");
  await expect(path(page)).toHaveAttribute("d", original!);
});
