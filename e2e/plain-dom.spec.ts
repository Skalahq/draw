import { execFileSync } from "node:child_process";
import { cp, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Locator } from "@playwright/test";

const fixtureFiles = join(process.cwd(), "fixtures/plain-dom");
const drawPackage = join(process.cwd(), "packages/draw");
let consumer: string | undefined;
let server: Bun.Server<undefined> | undefined;

function bun(cwd: string, ...args: string[]) {
  return execFileSync(process.execPath, args, { cwd, encoding: "utf8" });
}

async function box(locator: Locator) {
  await expect(locator).toBeVisible();
  const bounds = await locator.boundingBox();
  if (!bounds) throw new Error("Missing canvas geometry");
  return bounds;
}

test.beforeAll(async () => {
  const directory = await mkdtemp(join(tmpdir(), "draw-plain-dom-"));
  consumer = directory;
  await Promise.all(["index.html", "main.js", "core.js"].map((file) => cp(join(fixtureFiles, file), join(directory, file))));
  await Bun.write(join(directory, "package.json"), '{"name":"draw-plain-dom-proof","private":true,"type":"module"}\n');
  bun(drawPackage, "pm", "pack", "--destination", directory);
  const tarball = (await readdir(directory)).find((file) => file.endsWith(".tgz"));
  if (!tarball) throw new Error("Missing packed @skalahq/draw tarball");
  bun(directory, "add", `./${tarball}`);
  bun(directory, "run", "core.js");
  bun(directory, "build", "./main.js", "--target=browser", "--outdir=public");
  const html = Bun.file(join(directory, "index.html"));
  const js = Bun.file(join(directory, "public/main.js"));
  const css = Bun.file(join(directory, "public/main.css"));
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    routes: {
      "/": () => new Response(html),
      "/main.js": () => new Response(js),
      "/main.css": () => new Response(css),
    },
  });
});

test.afterAll(async () => {
  await server?.stop(true);
  if (consumer) await rm(consumer, { recursive: true, force: true });
});

test.beforeEach(async ({ page }) => {
  if (!server) throw new Error("Missing packed consumer server");
  await page.goto(server.url.href);
});

test("plain JavaScript uses Draw's shared keyboard, pointer, camera and history", async ({ page }) => {
  const canvas = page.getByRole("region", { name: "Plain drawing" });
  const first = page.getByRole("group", { name: "Note 1", exact: true });
  const second = page.getByRole("group", { name: "Note 2", exact: true });
  const edits = page.getByRole("status", { name: "Committed edits" });
  await page.getByRole("button", { name: "Add to first document" }).click();
  await expect(first).toHaveText("note");
  await page.getByRole("button", { name: "Insert", exact: true }).click();
  await page.keyboard.press("Enter");
  await expect(second).toBeVisible();
  await expect(edits).toHaveText("2");

  await page.getByRole("button", { name: "Select", exact: true }).click();
  await expect(canvas).toBeFocused();
  await page.keyboard.press("[");
  const original = await box(first);
  await page.keyboard.press("ArrowRight");
  expect((await box(first)).x).toBe(original.x + 1);
  await page.keyboard.press("Control+z");
  expect((await box(first)).x).toBe(original.x);
  await page.keyboard.press("Escape");

  await page.mouse.move(original.x + 20, original.y + 20);
  await page.mouse.down();
  await expect(first).toHaveAttribute("data-selected", "");
  await page.mouse.move(original.x + 65, original.y + 50, { steps: 4 });
  await expect(edits).toHaveText("4");
  await page.mouse.up();
  expect((await box(first)).x).toBe(original.x + 45);
  await page.keyboard.press("Control+z");
  expect((await box(first)).x).toBe(original.x);

  await page.getByRole("button", { name: "Pan", exact: true }).click();
  const frame = await box(canvas);
  await page.mouse.move(frame.x + 190, frame.y + 230);
  await page.mouse.down();
  await page.mouse.move(frame.x + 230, frame.y + 250, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => (await box(first)).x).toBe(original.x + 40);
  await page.keyboard.press("+");
  await expect.poll(async () => (await box(first)).width).toBeGreaterThan(original.width);
  await expect(edits).toHaveText("6");
  await page.getByRole("button", { name: "Insert", exact: true }).click();
  await canvas.click({ position: { x: 135, y: 170 } });
  expect((await box(page.getByRole("group", { name: "Note 3" }))).x).toBeCloseTo(frame.x + 135, 0);
});

test("updating, disposing and remounting hand off input and keep host content intact", async ({ page }) => {
  const canvas = page.getByRole("region", { name: "Plain drawing" });
  const edits = page.getByRole("status", { name: "Committed edits" });
  await page.getByRole("button", { name: "Add to first document" }).click();
  await page.getByRole("button", { name: "Use custom renderer" }).click();
  const input = page.getByRole("textbox", { name: "Node draft" });
  await input.fill("native draft");
  await input.press("End");
  await input.press("Backspace");
  await input.click();
  await expect(input).toBeFocused();
  await expect(input).toHaveValue("native draf");
  await expect(edits).toHaveText("1");
  await page.getByRole("button", { name: "Select", exact: true }).click();
  await page.keyboard.press("]");
  await page.keyboard.press("ArrowDown");
  await expect(input).toHaveValue("native draf");
  await expect(edits).toHaveText("2");

  await page.getByRole("button", { name: "Use second document" }).click();
  const replacement = page.getByRole("region", { name: "Second drawing" });
  await expect(canvas).toHaveCount(0);
  await expect(replacement.getByRole("group", { name: "Other note" })).toBeVisible();
  await expect(replacement.getByRole("group", { name: "Note 1" })).toHaveCount(0);
  await page.getByRole("button", { name: "Insert", exact: true }).click();
  const oldCanvas = await replacement.elementHandle();
  const frame = await box(replacement);
  await page.mouse.move(frame.x + 30, frame.y + 180);
  await page.mouse.down();
  await page.getByRole("button", { name: "Dispose", exact: true }).evaluate((button) => (button as HTMLButtonElement).click());
  await page.mouse.up();
  await expect(replacement).toHaveCount(0);
  await expect(page.getByText("Host content stays mounted")).toBeVisible();
  expect(await oldCanvas.evaluate((root) => root.dispatchEvent(new KeyboardEvent("keydown", {
    key: "z", ctrlKey: true, bubbles: true, cancelable: true,
  })))).toBe(true);
  expect(await oldCanvas.evaluate((root) => root.dispatchEvent(new WheelEvent("wheel", {
    deltaY: 100, bubbles: true, cancelable: true,
  })))).toBe(true);
  await expect(edits).toHaveText("2");

  await page.getByRole("button", { name: "Remount", exact: true }).click();
  await expect(replacement.getByRole("group", { name: "Other note" })).toBeVisible();
  await expect(replacement.getByRole("group", { name: "Note 1" })).toHaveCount(0);
  await replacement.focus();
  await page.keyboard.press("Enter");
  await expect(replacement.getByRole("group", { name: "Note 2" })).toBeVisible();
  await expect(edits).toHaveText("3");
});
