import { expect, test, type Page } from "@playwright/test";

const canvas = (page: Page) => page.getByRole("region", { name: "Drawing canvas" });
const note = (page: Page, name: string) => canvas(page).getByRole("group", { name, exact: true });
const root = (page: Page) => page.locator("main");
const saveStatus = (page: Page) => page.getByRole("status", { name: "Save status" });

async function createWorkspace(page: Page, name: string) {
  await page.getByLabel("New workspace").fill(name);
  await page.getByRole("button", { name: "Create workspace", exact: true }).click();
  await expect(root(page)).toHaveAttribute("data-workspace-name", name);
}

async function createCanvas(page: Page, title: string) {
  await page.getByLabel("New canvas").fill(title);
  await page.getByRole("button", { name: "Create canvas", exact: true }).click();
  await expect(root(page)).toHaveAttribute("data-canvas-title", title);
}

async function savedAfter(page: Page, edit: () => Promise<void>) {
  const before = Number(await saveStatus(page).getAttribute("data-save-generation"));
  await edit();
  await expect(saveStatus(page)).toHaveAttribute("data-save-generation", String(before + 1));
  await expect(saveStatus(page)).toHaveText("Saved");
}

async function readStored(page: Page, store: string, key: string) {
  return page.evaluate(async ({ store, key }) => {
    const name = document.querySelector("main")?.getAttribute("data-storage");
    if (!name) throw new Error("Missing storage name");
    const opened = indexedDB.open(name);
    const database = Promise.withResolvers<IDBDatabase>();
    opened.onsuccess = () => database.resolve(opened.result);
    opened.onerror = () => database.reject(opened.error ?? new Error("IndexedDB open failed"));
    const db = await database.promise;
    try {
      const transaction = db.transaction(store, "readonly");
      const request = transaction.objectStore(store).get(key);
      const stored = Promise.withResolvers<unknown>();
      request.onsuccess = () => stored.resolve(request.result ?? null);
      request.onerror = () => stored.reject(request.error ?? new Error("IndexedDB read failed"));
      return await stored.promise;
    } finally {
      db.close();
    }
  }, { store, key });
}

test("named workspaces and canvases reopen after reload without editor data in the document", async ({ page }) => {
  await page.goto("/workspaces");
  await expect(page.getByLabel("New workspace")).toBeEnabled();
  await createWorkspace(page, "Studio");
  await createCanvas(page, "Sketch A");
  await savedAfter(page, () => page.getByRole("button", { name: "Add note", exact: true }).click());
  await expect(note(page, "Note 1")).toBeVisible();

  await page.getByLabel("Workspace name").fill("Studio West");
  await page.getByRole("button", { name: "Rename workspace", exact: true }).click();
  await expect(root(page)).toHaveAttribute("data-workspace-name", "Studio West");
  await page.getByLabel("Canvas title").fill("Morning sketch");
  await page.getByRole("button", { name: "Rename canvas", exact: true }).click();
  await expect(root(page)).toHaveAttribute("data-canvas-title", "Morning sketch");

  await page.getByRole("button", { name: "Pan", exact: true }).click();
  await expect(root(page)).toHaveAttribute("data-tool-stored", "pan");
  await createCanvas(page, "Sketch B");
  await page.getByRole("button", { name: "Add note", exact: true }).click();
  await expect(note(page, "Note 1")).toBeVisible();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(note(page, "Note 1")).toHaveCount(0);

  await page.getByRole("button", { name: "Morning sketch", exact: true }).click();
  await expect(root(page)).toHaveAttribute("data-canvas-title", "Morning sketch");
  await expect(note(page, "Note 1")).toBeVisible();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(note(page, "Note 1")).toBeVisible();

  await page.getByRole("button", { name: "Select", exact: true }).click();
  const drawing = canvas(page);
  await drawing.press("]");
  const origin = await note(page, "Note 1").boundingBox();
  if (!origin) throw new Error("Missing note geometry");
  await savedAfter(page, () => drawing.press("ArrowRight"));
  await expect.poll(async () => (await note(page, "Note 1").boundingBox())?.x).toBe(origin.x + 1);
  await page.getByRole("button", { name: "Sketch B", exact: true }).click();
  await expect(note(page, "Note 1")).toHaveCount(0);
  await page.getByRole("button", { name: "Morning sketch", exact: true }).click();
  const kept = await note(page, "Note 1").boundingBox();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  expect(await note(page, "Note 1").boundingBox()).toEqual(kept);
  await page.getByRole("button", { name: "Pan", exact: true }).click();
  await expect(root(page)).toHaveAttribute("data-tool-stored", "pan");
  await page.reload();
  await expect(page.getByRole("button", { name: "Studio West", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(root(page)).toHaveAttribute("data-canvas-title", "Morning sketch");
  await expect(note(page, "Note 1")).toBeVisible();
  await expect(page.getByRole("button", { name: "Pan", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(note(page, "Note 1")).toBeVisible();

  const canvasId = await root(page).getAttribute("data-canvas-id");
  const snapshot = await readStored(page, "documents", canvasId ?? "");
  expect(typeof snapshot).toBe("string");
  const document = JSON.parse(String(snapshot)) as { version: number; nodes: { bounds: { x: number } }[] };
  expect(document.version).toBe(1);
  expect(document.nodes[0]?.bounds.x).toBe(67);
  expect(JSON.stringify(document)).not.toContain("Morning sketch");
  expect(JSON.stringify(document)).not.toContain("Studio West");
  expect(JSON.stringify(document)).not.toContain("pan");
  expect(await readStored(page, "preferences", "tool")).toBe("pan");
  expect(await readStored(page, "preferences", "workspaceId")).toBe(await root(page).getAttribute("data-workspace-id"));

  await page.getByLabel("New workspace").fill("Other studio");
  await page.getByRole("button", { name: "Create workspace", exact: true }).click();
  await expect(root(page)).toHaveAttribute("data-workspace-name", "Other studio");
  await expect(note(page, "Note 1")).toHaveCount(0);
  await page.getByRole("button", { name: "Studio West", exact: true }).click();
  await expect(note(page, "Note 1")).toBeVisible();
});

test("switching canvases flushes the newest edits before the next document opens", async ({ page }) => {
  await page.goto("/workspaces");
  await expect(page.getByLabel("New workspace")).toBeEnabled();
  await createWorkspace(page, "Flush studio");
  await createCanvas(page, "Sketch A");
  const first = await root(page).getAttribute("data-canvas-id");
  await page.getByRole("button", { name: "Add note", exact: true }).click();
  await expect(note(page, "Note 1")).toBeVisible();
  await createCanvas(page, "Sketch B");
  await expect(root(page)).not.toHaveAttribute("data-canvas-id", first ?? "");
  await page.reload();
  await page.getByRole("button", { name: "Sketch A", exact: true }).click();
  await expect(note(page, "Note 1")).toBeVisible();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(note(page, "Note 1")).toBeVisible();
});
