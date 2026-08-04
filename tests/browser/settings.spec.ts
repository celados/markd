import { expect, test } from "@playwright/test";
import { installRiffleFixture } from "./riffle-fixture";

test.beforeEach(async ({ page }) => {
  await installRiffleFixture(page);
  await page.goto("/");
});

test("settings shortcut renders every page without runtime errors", async ({
  page,
}) => {
  const runtimeErrors: string[] = [];
  page.on("pageerror", (error) => runtimeErrors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") runtimeErrors.push(message.text());
  });

  await page.keyboard.press("ControlOrMeta+,");
  const dialog = page.getByRole("dialog", { name: "Settings" });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "General" }),
  ).toHaveAttribute("aria-current", "page");

  for (const pageName of ["Riffle Cloud", "Appearance", "Shortcuts", "General"]) {
    await dialog.getByRole("button", { name: pageName }).click();
    await expect(
      dialog.getByRole("heading", { name: pageName, exact: true }),
    ).toBeVisible();
  }

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  expect(runtimeErrors).toEqual([]);
});
