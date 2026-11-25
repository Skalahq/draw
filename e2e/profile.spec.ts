import { expect, test } from "@playwright/test";

test("1000 nodes stay responsive under pan, zoom, drag, and freehand", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/profile");
  const surface = page.getByRole("region", { name: "Profile canvas" });
  await expect(page.locator(".draw-node")).toHaveCount(1000);
  await expect(page.locator(".draw-connection")).toHaveCount(975);
  const box = await surface.boundingBox();
  if (!box) throw new Error("Missing profile canvas");
  const node = page.getByRole("group", { name: "N0", exact: true });

  await page.getByRole("button", { name: "Reset frame gaps" }).click();
  const select = page.getByRole("button", { name: "Select", exact: true });
  await select.click();
  await expect(select).toHaveAttribute("aria-pressed", "true");
  const beforeDrag = await node.boundingBox();
  if (!beforeDrag) throw new Error("Missing N0");
  await page.mouse.move(beforeDrag.x + beforeDrag.width / 2, beforeDrag.y + beforeDrag.height / 2);
  await page.mouse.down();
  await page.mouse.move(beforeDrag.x + beforeDrag.width / 2 + 36, beforeDrag.y + beforeDrag.height / 2 + 12, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await node.boundingBox())?.x ?? 0).toBeGreaterThan(beforeDrag.x + 8);

  const pan = page.getByRole("button", { name: "Pan", exact: true });
  await pan.click();
  await expect(pan).toHaveAttribute("aria-pressed", "true");
  const beforePan = await node.boundingBox();
  if (!beforePan) throw new Error("Missing N0 after drag");
  await surface.focus();
  await page.keyboard.press("ArrowLeft");
  await expect.poll(async () => (await node.boundingBox())?.x ?? beforePan.x).toBeGreaterThan(beforePan.x + 20);

  const beforeZoom = await node.boundingBox();
  if (!beforeZoom) throw new Error("Missing N0 after pan");
  await page.keyboard.press("+");
  await expect.poll(async () => (await node.boundingBox())?.width ?? 0).toBeGreaterThan(beforeZoom.width);

  const freehand = page.getByRole("button", { name: "Freehand", exact: true });
  await freehand.click();
  await expect(freehand).toHaveAttribute("aria-pressed", "true");
  await page.mouse.move(box.x + 24, box.y + box.height - 24);
  await page.mouse.down();
  await page.mouse.move(box.x + 140, box.y + box.height - 24, { steps: 8 });
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(page.getByLabel("Node count")).toHaveText("1000");
  await page.mouse.move(box.x + 24, box.y + box.height - 24);
  await page.mouse.down();
  await page.mouse.move(box.x + 140, box.y + box.height - 24, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByRole("group", { name: "draw:stroke", exact: true })).toHaveCount(1);
  await expect(page.getByLabel("Node count")).toHaveText("1001");

  const gap = Number(await page.getByLabel("Max frame gap").textContent());
  console.log(JSON.stringify({ nodes: 1000, connections: 975, maxFrameGapMs: gap }));
  expect(gap).toBeGreaterThan(0);
  expect(gap).toBeLessThan(1000);
});
