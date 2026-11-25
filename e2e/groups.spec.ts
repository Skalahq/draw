import { expect, test, type Locator, type Page } from "@playwright/test";

const canvas = (page: Page) => page.getByRole("region", { name: "Drawing canvas" });
const card = (page: Page) => page.getByRole("group", { name: "Card", exact: true });
const stroke = (page: Page) => page.getByRole("group", { name: "Freehand stroke", exact: true });
const nearby = (page: Page) => page.getByRole("group", { name: "Nearby", exact: true });
const selection = (page: Page) => page.getByRole("status", { name: "Selection" });
const groups = (page: Page) => page.getByRole("status", { name: "Groups" });
const positions = (page: Page) => page.getByRole("status", { name: "Node positions" });
const connections = (page: Page) => page.getByRole("status", { name: "Connections" });

async function box(locator: Locator) {
  await expect(locator).toBeVisible();
  const bounds = await locator.boundingBox();
  if (!bounds) throw new Error("Missing visible geometry");
  return bounds;
}

async function shiftClick(page: Page, x: number, y: number) {
  await page.keyboard.down("Shift");
  await page.mouse.click(x, y);
  await page.keyboard.up("Shift");
}

test("mixed selection groups a component, a stroke, and a connection", async ({ page }) => {
  await page.goto("/groups");
  const moveCard = card(page).getByRole("button", { name: "Move Card" });
  await expect(canvas(page)).toBeVisible();
  await moveCard.click();
  const cardBox = await box(card(page));
  const strokeBox = await box(stroke(page));
  await shiftClick(page, strokeBox.x + strokeBox.width / 2, strokeBox.y + strokeBox.height / 2);
  await shiftClick(page, (cardBox.x + cardBox.width + strokeBox.x) / 2, cardBox.y + cardBox.height / 2);

  await expect(card(page)).toHaveAttribute("data-selected", "");
  await expect(stroke(page)).toHaveAttribute("data-selected", "");
  await expect(page.locator(".draw-connection[data-selected]")).toHaveCount(1);
  await expect(selection(page)).toHaveText("card,ink,link");
  await expect(nearby(page)).not.toHaveAttribute("data-selected", "");

  await page.keyboard.press("g");
  await expect(groups(page)).toHaveText("group-1:card+ink");
  await expect(connections(page)).toHaveText("link:card.out>ink");
  await expect(positions(page)).toHaveText("card:40,80,160,80 ink:360,96,48,48 nearby:40,220,80,40");
  await expect(page.getByRole("group", { name: "Group group-1" })).toBeVisible();

  await page.keyboard.press("ArrowRight");
  await expect(positions(page)).toHaveText("card:41,80,160,80 ink:361,96,48,48 nearby:40,220,80,40");
  await expect(connections(page)).toHaveText("link:card.out>ink");

  await page.getByRole("button", { name: "Move group group-1" }).click();
  const nearbyMove = await box(nearby(page).getByRole("button", { name: "Move Nearby" }));
  await shiftClick(page, nearbyMove.x + nearbyMove.width / 2, nearbyMove.y + nearbyMove.height / 2);
  await expect(selection(page)).toHaveText("group-1,nearby");
  await page.getByRole("button", { name: "Group", exact: true }).click();
  await expect(groups(page)).toHaveText("group-1:card+ink group-2:group-1+nearby");
  await canvas(page).press("]");
  await canvas(page).press("]");
  await expect(selection(page)).toHaveText("group-2");
  await canvas(page).press("ArrowRight");
  await expect(connections(page)).toHaveText("link:card.out>ink");

  await canvas(page).press("Shift+G");
  await expect(groups(page)).toHaveText("group-1:card+ink");
  await expect(positions(page)).toHaveText("card:42,80,160,80 ink:362,96,48,48 nearby:41,220,80,40");
  await expect(connections(page)).toHaveText("link:card.out>ink");

  await page.getByRole("button", { name: "Move group group-1" }).click();
  await page.getByRole("button", { name: "Ungroup", exact: true }).click();
  await expect(groups(page)).toHaveText("");
  await expect(positions(page)).toHaveText("card:42,80,160,80 ink:362,96,48,48 nearby:41,220,80,40");
  await expect(connections(page)).toHaveText("link:card.out>ink");

  const handle = await box(moveCard);
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2 + 24, handle.y + handle.height / 2, { steps: 4 });
  await page.mouse.up();
  await expect(positions(page)).toHaveText("card:66,80,160,80 ink:362,96,48,48 nearby:41,220,80,40");
  await expect(connections(page)).toHaveText("link:card.out>ink");

  await moveCard.click();
  await shiftClick(page, strokeBox.x + 22, strokeBox.y + strokeBox.height / 2);
  const relink = await box(card(page));
  const restroke = await box(stroke(page));
  await shiftClick(page, (relink.x + relink.width + restroke.x) / 2, relink.y + relink.height / 2);
  await canvas(page).press("g");
  await expect(groups(page)).toHaveText("group-1:card+ink");
  const beforeDelete = await positions(page).textContent();
  await page.getByRole("button", { name: "Move group group-1" }).click();
  await canvas(page).press("Delete");
  await expect(groups(page)).toHaveText("");
  await expect(positions(page)).toHaveText("nearby:41,220,80,40");
  await expect(connections(page)).toHaveText("");

  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(groups(page)).toHaveText("group-1:card+ink");
  await expect(positions(page)).toHaveText(beforeDelete ?? "");
  await expect(connections(page)).toHaveText("link:card.out>ink");
});
