import { expect, test, type Locator, type Page } from "@playwright/test";

const stroke = (page: Page) => page.getByRole("group", { name: "Freehand stroke", exact: true });
const note = (page: Page) => page.getByRole("group", { name: "Sketch note 1", exact: true });
const commits = (page: Page) => page.getByRole("status", { name: "Committed edits" });
const tool = (page: Page, name: string) => page.getByRole("button", { name, exact: true });

async function bounds(locator: Locator) {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  if (!box) throw new Error("Missing visible geometry");
  return box;
}

async function openSketch(page: Page) {
  await page.goto("/sketch");
  await tool(page, "Freehand").click();
  const box = await bounds(page.getByRole("region", { name: "Drawing canvas" }));
  return { x: Math.floor(box.x + box.width / 2), y: Math.floor(box.y + box.height / 2) };
}

async function pixel(page: Page, x: number, y: number) {
  const image = await page.screenshot({ clip: { x, y, width: 1, height: 1 } });
  return page.evaluate(async (bytes) => {
    const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: "image/png" }));
    const context = new OffscreenCanvas(1, 1).getContext("2d")!;
    context.drawImage(bitmap, 0, 0);
    return Array.from(context.getImageData(0, 0, 1, 1).data);
  }, Array.from(image));
}

async function drag(page: Page, x: number, y: number, dx: number, dy: number) {
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 8 });
  await page.mouse.up();
}

const ink = [32, 58, 66, 255];
const paper = [255, 255, 255, 255];

test("DOM nodes and strokes share painting, selection, camera, and undo history", async ({ page }) => {
  const { x, y } = await openSketch(page);
  await drag(page, x - 100, y + 16, 200, 0);
  await expect(stroke(page)).toHaveCount(1);
  await expect(commits(page)).toHaveText("1");

  await tool(page, "Insert note").click();
  await page.keyboard.press("Enter");
  await expect(note(page)).toBeVisible();
  await expect.poll(() => pixel(page, x, y + 16)).toEqual(paper);
  await tool(page, "Select").click();
  await page.mouse.click(x, y + 16);
  await page.keyboard.press("Delete");
  await expect(note(page)).toHaveCount(0);
  await expect(stroke(page)).toHaveCount(1);
  await expect.poll(() => pixel(page, x, y + 16)).toEqual(ink);
  await tool(page, "Undo").click();

  await tool(page, "Freehand").click();
  await page.mouse.move(x - 100, y - 16);
  await page.mouse.down();
  await page.mouse.move(x + 100, y - 16, { steps: 12 });
  await expect.poll(() => pixel(page, x, y - 16)).toEqual(ink);
  await expect(stroke(page)).toHaveCount(1);
  await expect(commits(page)).toHaveText("4");
  await page.mouse.up();
  await expect(stroke(page)).toHaveCount(2);
  await expect(commits(page)).toHaveText("5");
  await expect.poll(() => pixel(page, x, y - 16)).toEqual(ink);

  await tool(page, "Select").click();
  await page.mouse.click(x, y - 16);
  await page.keyboard.press("Delete");
  await expect(stroke(page)).toHaveCount(1);
  await expect(note(page)).toBeVisible();
  await expect.poll(() => pixel(page, x, y - 16)).toEqual(paper);
  await tool(page, "Undo").click();
  await tool(page, "Undo").click();
  await expect(stroke(page)).toHaveCount(1);
  await tool(page, "Redo").click();
  await expect(stroke(page)).toHaveCount(2);

  await tool(page, "Freehand").click();
  await page.mouse.move(x - 50, y - 25);
  await page.mouse.down();
  await page.mouse.move(x + 50, y - 25);
  await page.mouse.move(x + 50, y + 25);
  await page.mouse.up();
  await expect(stroke(page)).toHaveCount(3);
  await tool(page, "Select").click();
  await page.mouse.click(x - 20, y + 6);
  await page.keyboard.press("Delete");
  await expect(note(page)).toHaveCount(0);
  await expect(stroke(page)).toHaveCount(3);
  await tool(page, "Undo").click();

  const topStroke = stroke(page).nth(1);
  const before = await bounds(topStroke);
  const beforeNote = await bounds(note(page));
  await tool(page, "Pan").click();
  await drag(page, x + 260, y + 120, 36, 24);
  await expect.poll(async () => (await bounds(topStroke)).x).toBeCloseTo(before.x + 36);
  await expect.poll(async () => (await bounds(note(page))).x).toBeCloseTo(beforeNote.x + 36);
  await page.keyboard.press("+");
  await expect.poll(async () => (await bounds(topStroke)).width).toBeGreaterThan(before.width);
  const zoomed = await bounds(topStroke);
  const zoomedNote = await bounds(note(page));
  expect(zoomed.width / before.width).toBeCloseTo(zoomedNote.width / beforeNote.width);
  expect(zoomed.y + zoomed.height / 2).toBeGreaterThan(zoomedNote.y);
  expect(zoomed.y + zoomed.height / 2).toBeLessThan(zoomedNote.y + zoomedNote.height);
});

test("a stroke moves in one edit and Escape removes a preview without committing", async ({ page }) => {
  const { x, y } = await openSketch(page);
  await page.mouse.move(x - 60, y);
  await page.mouse.down();
  await page.mouse.move(x + 60, y, { steps: 8 });
  await expect.poll(() => pixel(page, x, y)).toEqual(ink);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(stroke(page)).toHaveCount(0);
  await expect(commits(page)).toHaveText("0");
  await expect.poll(() => pixel(page, x, y)).not.toEqual(ink);

  await drag(page, x - 60, y, 120, 0);
  await expect(stroke(page)).toHaveCount(1);
  const before = await bounds(stroke(page));
  await tool(page, "Select").click();
  await drag(page, x, y, 40, 35);
  await expect(commits(page)).toHaveText("2");
  await expect.poll(async () => (await bounds(stroke(page))).x).toBeCloseTo(before.x + 40);
  await expect.poll(async () => (await bounds(stroke(page))).y).toBeCloseTo(before.y + 35);
  await page.keyboard.press("Control+z");
  expect(await bounds(stroke(page))).toEqual(before);
  await page.keyboard.press("Control+z");
  await expect(stroke(page)).toHaveCount(0);
});

test("touch and pen draw editable strokes; a touch cancel does not commit", async ({ page, context }) => {
  const { x, y } = await openSketch(page);
  const input = await context.newCDPSession(page);
  const touch = ["touchStart", "touchMove", "touchEnd", "touchCancel"] as const;
  const dispatchTouch = (type: typeof touch[number], at?: [number, number]) => input.send("Input.dispatchTouchEvent", {
    type,
    touchPoints: at ? [{ x: at[0], y: at[1] }] : [],
  });

  await dispatchTouch("touchStart", [x - 60, y]);
  await dispatchTouch("touchMove", [x + 60, y]);
  await expect.poll(() => pixel(page, x, y)).toEqual(ink);
  await dispatchTouch("touchCancel");
  await expect.poll(() => pixel(page, x, y)).not.toEqual(ink);
  await expect(stroke(page)).toHaveCount(0);
  await expect(commits(page)).toHaveText("0");

  await dispatchTouch("touchStart", [x - 60, y]);
  await dispatchTouch("touchMove", [x, y + 25]);
  await dispatchTouch("touchEnd");
  await expect(stroke(page)).toHaveCount(1);
  await expect(commits(page)).toHaveText("1");

  await input.send("Input.dispatchMouseEvent", { type: "mousePressed", x: x + 40, y, pointerType: "pen", button: "left", buttons: 1 });
  await input.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: x + 80, y: y - 35, pointerType: "pen", buttons: 1 });
  await input.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: x + 80, y: y - 35, pointerType: "pen", button: "left" });
  await expect(stroke(page)).toHaveCount(2);
  await expect(commits(page)).toHaveText("2");

  await tool(page, "Select").click();
  await page.mouse.click(x + 80, y - 35);
  await page.keyboard.press("Delete");
  await expect(stroke(page)).toHaveCount(1);
});
