import { expect, test, type Locator, type Page } from "@playwright/test";

async function box(locator: Locator) {
  await expect(locator).toBeVisible();
  const bounds = await locator.boundingBox();
  if (!bounds) throw new Error("Missing visible workflow node geometry");
  return bounds;
}

async function openWorkflow(page: Page) {
  await page.goto("/workflow");
  await expect(page.getByRole("status", { name: "Live Solid nodes" })).toHaveText("1");
}

test("live React and Solid controls keep native focus and keys; only the handle moves a live node", async ({ page }) => {
  await openWorkflow(page);
  const canvas = page.getByRole("region", { name: "Workflow canvas" });
  const solid = canvas.getByRole("group", { name: "Solid review" });
  const react = canvas.getByRole("group", { name: "React note" });
  const input = react.getByRole("textbox", { name: "Note" });
  const initial = await box(react);

  // A previously selected node must survive editable keys, including native Undo.
  await canvas.focus();
  await page.keyboard.press("]");
  await react.getByText("Note", { exact: true }).click();
  await expect(input).toBeFocused();
  await input.pressSequentially("abc");
  await input.press("ArrowLeft");
  await input.press("Delete");
  await input.press("Backspace");
  await expect(input).toHaveValue("a");
  await input.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
  await expect(input).not.toHaveValue("a");
  await expect(input).toBeFocused();
  expect(await box(react)).toEqual(initial);

  const review = solid.getByRole("button", { name: "Add review" });
  await review.click();
  await review.press("Space");
  await expect(review).toBeFocused();
  await expect(solid.getByRole("status", { name: "Reviews" })).toHaveText("2");

  const body = await box(react.getByText("React note", { exact: true }));
  await page.mouse.move(body.x + body.width / 2, body.y + body.height / 2);
  await page.mouse.down();
  await page.mouse.move(body.x + body.width / 2 + 48, body.y + body.height / 2 + 24);
  await page.mouse.up();
  expect(await box(react)).toEqual(initial);

  const move = react.getByRole("button", { name: "Move React note" });
  const handle = await box(move);
  const x = handle.x + handle.width / 2;
  const y = handle.y + handle.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 48, y + 24, { steps: 4 });
  await page.mouse.up();
  await expect.poll(() => box(react)).toMatchObject({ x: initial.x + 48, y: initial.y + 24 });
  await expect(canvas).toBeFocused();
  await page.keyboard.press("Control+z");
  await expect.poll(() => box(react)).toEqual(initial);

  await move.focus();
  await page.keyboard.press("Enter");
  await expect(canvas).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect.poll(async () => (await box(react)).x).toBe(initial.x + 1);
});

test("layout is local to a renderer; an explicit resize is a Draw edit", async ({ page }) => {
  await openWorkflow(page);
  const react = page.getByRole("group", { name: "React note" });
  const initial = await box(react);
  const undo = page.getByRole("button", { name: "Undo", exact: true });

  await react.getByRole("button", { name: "Show preview" }).click();
  await expect(react.getByText("Draft preview", { exact: true })).toBeAttached();
  expect(await box(react)).toEqual(initial);
  await expect(undo).toBeDisabled();

  await react.getByRole("button", { name: "Fit node to content" }).click();
  await expect.poll(async () => (await box(react)).height).toBeGreaterThan(initial.height);
  await undo.click();
  await expect.poll(() => box(react)).toEqual(initial);
  await expect(react.getByText("Draft preview", { exact: true })).toBeAttached();
});

test("foreign content updates without remounting and disposes on node removal and canvas unmount", async ({ page }) => {
  await openWorkflow(page);
  const solid = page.getByRole("group", { name: "Solid review" });
  const live = page.getByRole("status", { name: "Live Solid nodes" });
  const reviews = solid.getByRole("status", { name: "Reviews" });
  const x = solid.getByRole("status", { name: "Node x" });
  await expect(x).toHaveText("336");
  await solid.getByRole("button", { name: "Add review" }).click();
  await page.getByRole("button", { name: "Nudge Solid node" }).click();
  await expect(x).toHaveText("352");
  await expect(reviews).toHaveText("1");
  await expect(live).toHaveText("1");

  await solid.getByRole("button", { name: "Move Solid review" }).press("Enter");
  await page.keyboard.press("Delete");
  await expect(solid).toHaveCount(0);
  await expect(live).toHaveText("0");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(live).toHaveText("1");
  await expect(reviews).toHaveText("0");
  await expect(x).toHaveText("352");

  await page.getByRole("button", { name: "Hide canvas" }).click();
  await expect(live).toHaveText("0");
  await page.getByRole("button", { name: "Show canvas" }).click();
  await expect(live).toHaveText("1");
  await expect(x).toHaveText("352");
});

test("an unregistered node is movable and preserves its document data", async ({ page }) => {
  await openWorkflow(page);
  const unknown = page.getByRole("group", { name: "External step" });
  await expect(unknown.getByText("Unknown node type: external.step")).toBeVisible();
  const initial = await box(unknown);
  await page.getByRole("button", { name: "Move External step" }).press("Enter");
  await page.keyboard.press("ArrowRight");
  await expect.poll(async () => (await box(unknown)).x).toBe(initial.x + 1);
  await page.getByText("Document snapshot", { exact: true }).click();
  const snapshot = page.getByRole("region", { name: "Document snapshot" });
  const raw = await snapshot.textContent();
  const document = JSON.parse(raw ?? "");
  expect(document.nodes.find(({ id }: { id: string }) => id === "workflow-external")).toEqual({
    id: "workflow-external",
    type: "external.step",
    bounds: { x: 49, y: 280, width: 232, height: 80 },
    metadata: { label: "External step", source: { system: "inventory", key: "M-72" } },
  });
});
