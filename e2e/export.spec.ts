import { readFile } from "node:fs/promises";
import { inflateSync } from "node:zlib";
import { expect, test, type Download, type Page } from "@playwright/test";
import { getConnectionGeometry, getStrokeGeometry, strokeNodeType, type DrawNode } from "@skalahq/draw/core";

const note: DrawNode = { id: "note", type: "note", bounds: { x: 40, y: 48, width: 160, height: 72 }, metadata: { label: "Field note" } };
const badge: DrawNode = { id: "badge", type: "badge", bounds: { x: 280, y: 48, width: 120, height: 72 }, metadata: { label: "Badge" } };
const stroke: DrawNode = {
  id: "stroke",
  type: strokeNodeType,
  bounds: { x: 40, y: 140, width: 120, height: 20 },
  metadata: { points: [{ x: 2, y: 10 }, { x: 118, y: 10 }] },
};
const link = { id: "link", source: { nodeId: "note" }, target: { nodeId: "badge" } };

async function file(download: Download) {
  const path = await download.path();
  if (!path) throw new Error("Missing download");
  return readFile(path);
}

async function download(page: Page, name: string) {
  const [item] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name }).click(),
  ]);
  return file(item);
}

function decodePng(png: Uint8Array) {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let offset = 8;
  let width = 0;
  let height = 0;
  const idat: Uint8Array[] = [];
  while (offset + 12 <= png.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(png[offset + 4], png[offset + 5], png[offset + 6], png[offset + 7]);
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = new DataView(data.buffer, data.byteOffset, 8).getUint32(0);
      height = new DataView(data.buffer, data.byteOffset, 8).getUint32(4);
    } else if (type === "IDAT") idat.push(data);
    offset += 12 + length;
    if (type === "IEND") break;
  }
  const compressed = new Uint8Array(idat.reduce((sum, part) => sum + part.length, 0));
  let cursor = 0;
  for (const part of idat) {
    compressed.set(part, cursor);
    cursor += part.length;
  }
  const scanlines = inflateSync(compressed);
  const stride = width * 4;
  const pixels = new Uint8Array(width * height * 4);
  for (let row = 0; row < height; row++) pixels.set(scanlines.subarray(row * (stride + 1) + 1, (row + 1) * (stride + 1)), row * stride);
  return { width, height, pixels };
}

function pixel(image: { width: number; pixels: Uint8Array }, x: number, y: number) {
  const start = (y * image.width + x) * 4;
  return [...image.pixels.subarray(start, start + 4)];
}

test("the export demo shares one scene across SVG and PNG and ignores editor chrome", async ({ page }) => {
  await page.goto("/export");
  const canvas = page.getByRole("region", { name: "Drawing canvas" });
  await expect(canvas.getByRole("group", { name: "Field note" })).toBeVisible();
  await expect(canvas.getByRole("group", { name: "Badge" })).toBeVisible();
  await expect(canvas.getByText("Secret widget chrome")).toBeVisible();

  const svg = (await download(page, "Export SVG")).toString();
  const geometry = getConnectionGeometry(link, (id) => id === "note" ? note : badge);
  const strokeGeometry = getStrokeGeometry(stroke);
  if (!geometry || !strokeGeometry) throw new Error("expected demo geometry");
  expect(svg).toContain('viewBox="40 48 360 104"');
  expect(svg).toContain("Field note");
  expect(svg).toContain("Badge");
  expect(svg).toContain('fill="#779961"');
  expect(svg).toContain(`d="${geometry.path}"`);
  expect(svg).toContain(`d="${strokeGeometry.d}"`);
  expect(svg).not.toContain("Secret widget chrome");
  expect(svg).not.toContain("Live widget");
  expect(svg).not.toContain("Export SVG");
  expect(svg).not.toContain("draw-resize");
  await expect(page.getByLabel("SVG dimensions")).toHaveText("360 by 104");
  await expect(page.getByLabel("Unsupported content")).toHaveText("widget live-widget");

  const image = decodePng(await download(page, "Export PNG"));
  expect(image).toMatchObject({ width: 360, height: 104 });
  expect(pixel(image, 0, 0)).toEqual([32, 58, 66, 255]);
  expect(pixel(image, 320, 36)).toEqual([119, 153, 97, 255]);
  expect(pixel(image, 60, 102)).toEqual([32, 58, 66, 255]);
  await expect(page.getByLabel("PNG dimensions")).toHaveText("360 by 104");
  await expect(page.getByRole("img", { name: "Exported PNG preview" })).toBeVisible();

  await page.getByRole("button", { name: "Pan" }).click();
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Missing canvas");
  await page.mouse.move(box.x + 80, box.y + 80);
  await page.mouse.down();
  await page.mouse.move(box.x + 140, box.y + 120);
  await page.mouse.up();
  await canvas.press("+");
  await canvas.getByRole("group", { name: "Field note" }).click();
  expect((await download(page, "Export SVG")).toString()).toBe(svg);

  await page.getByRole("button", { name: "Freehand" }).click();
  await page.mouse.move(box.x + 30, box.y + box.height - 30);
  await page.mouse.down();
  await page.mouse.move(box.x + 180, box.y + box.height - 30, { steps: 6 });
  await expect(canvas.locator(".draw-stroke-preview")).toBeVisible();
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export SVG" }).dispatchEvent("click");
  expect((await file(await pending)).toString()).toBe(svg);
  await page.mouse.up();

  await page.getByRole("button", { name: "Crop to note" }).click();
  await page.getByRole("button", { name: "PNG scale 2x" }).click();
  const cropped = (await download(page, "Export SVG")).toString();
  expect(cropped).toContain('viewBox="40 48 160 72"');
  expect(cropped).toContain("Field note");
  expect(cropped).not.toContain("Badge");
  expect(decodePng(await download(page, "Export PNG"))).toMatchObject({ width: 320, height: 144 });
  await expect(page.getByLabel("SVG dimensions")).toHaveText("160 by 72");
  await expect(page.getByLabel("PNG dimensions")).toHaveText("320 by 144");
});
