import { expect, test } from "@playwright/test";
import { installTauriFixture } from "./tauri-fixture";

test.beforeEach(async ({ page }) => {
  await installTauriFixture(page);
});

test("note actions preserve keyboard focus and dismissal", async ({ page }) => {
  const runtimeErrors: string[] = [];
  page.on("pageerror", (error) => runtimeErrors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") runtimeErrors.push(message.text());
  });

  await page.goto("/");
  await page.getByRole("treeitem", { name: "README.md" }).click();

  await expect(
    page
      .getByLabel("Current note")
      .getByText("README", { exact: true })
      .filter({ visible: true }),
  ).toBeVisible();

  const trigger = page.getByRole("button", { name: "Note actions" });
  await trigger.click();
  await expect(page.getByRole("button", { name: "Pin note" })).toBeFocused();

  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("button", { name: "Add property" })).toBeFocused();
  await page.keyboard.press("End");
  await expect(page.getByRole("button", { name: "Delete note" })).toBeFocused();
  await expect(page.locator('[role="button"] button')).toHaveCount(0);

  await page.keyboard.press("Escape");
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await expect(trigger).toBeFocused();
  await expect(page.getByRole("button", { name: "Delete note" })).toHaveCount(0);

  await trigger.click();
  await page.locator("main").click({ position: { x: 500, y: 500 } });
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  expect(runtimeErrors).toEqual([]);
});
