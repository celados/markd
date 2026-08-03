import { expect, test } from "@playwright/test";
import { installTauriFixture } from "./tauri-fixture";

test.beforeEach(async ({ page }) => {
  await installTauriFixture(page);
  await page.goto("/");
  await page.getByRole("treeitem", { name: "README.md" }).click();
});

test("property names commit through portal dismissal paths", async ({ page }) => {
  await page.getByRole("button", { name: "Note actions" }).click();
  await page.getByRole("button", { name: "Add property" }).click();

  const nameInput = page.getByRole("textbox", { name: "Property name" });
  await expect(nameInput).toBeFocused();
  await nameInput.fill("status");
  await nameInput.press("Enter");
  await expect(page.getByRole("button", { name: "Edit status property" })).toBeVisible();

  await page.getByRole("button", { name: "Edit status property" }).click();
  await nameInput.fill("stage");
  await nameInput.press("Escape");
  await expect(page.getByRole("button", { name: "Edit stage property" })).toBeVisible();

  await page.getByRole("button", { name: "Edit stage property" }).click();
  await nameInput.fill("phase");
  await page.getByRole("heading", { name: "README" }).first().click();
  await expect(page.getByRole("button", { name: "Edit phase property" })).toHaveCount(1);
});

test("property delete actions follow only their own row hover", async ({ page }) => {
  await page.getByRole("button", { name: "Note actions" }).click();
  await page.getByRole("button", { name: "Add property" }).click();
  const nameInput = page.getByRole("textbox", { name: "Property name" });
  await nameInput.fill("status");
  await nameInput.press("Enter");
  const valueInput = page.getByRole("textbox", { name: "status value" });
  await valueInput.fill("active");
  await valueInput.press("Enter");

  const heading = page.getByRole("heading", { name: "README" }).first();
  const deleteButtons = page.getByRole("button", { name: "Delete property" });
  await page.locator('[data-note-editor="active"]').evaluate((element) => {
    // Rows must not inherit hover state from unrelated groups introduced by composition.
    element.classList.add("group");
  });
  await heading.hover();
  await expect(deleteButtons).toHaveCount(2);
  await expect(deleteButtons.nth(0)).toHaveCSS("opacity", "0");
  await expect(deleteButtons.nth(1)).toHaveCSS("opacity", "0");

  await page.getByRole("button", { name: "Edit status property" }).hover();
  await expect(deleteButtons.nth(0)).toHaveCSS("opacity", "0");
  await expect(deleteButtons.nth(1)).toHaveCSS("opacity", "1");

  await heading.hover();
  await expect(deleteButtons.nth(0)).toHaveCSS("opacity", "0");
  await expect(deleteButtons.nth(1)).toHaveCSS("opacity", "0");
});

test("command palette preserves result order and keyboard activation", async ({
  page,
}) => {
  await page.getByRole("button", { name: /^Search/ }).click();
  const dialog = page.getByRole("dialog", { name: "Command palette" });
  const input = page.getByPlaceholder("Search notes and commands…");
  await expect(dialog).toBeVisible();
  await expect(input).toBeFocused();

  await input.fill("alpha");
  await expect(page.getByText("Alpha result", { exact: true })).toBeVisible();
  await expect(page.getByText("README result", { exact: true })).toBeVisible();
  const results = dialog.getByRole("option");
  await expect(results.nth(0)).toContainText("Alpha result");
  await expect(results.nth(1)).toContainText("README result");

  await page.keyboard.press("Enter");
  await expect(dialog).toHaveCount(0);
  await expect(
    page
      .getByLabel("Current note")
      .getByText("Alpha", { exact: true })
      .filter({ visible: true }),
  ).toBeVisible();
  await expect.poll(() => page.evaluate(() => {
    const state = window as typeof window & {
      __MARKD_TEST__?: { commands: Array<{ command: string; args: Record<string, unknown> }> };
    };
    return state.__MARKD_TEST__?.commands.filter(
      (call) => call.command === "record_search_access",
    ) ?? [];
  })).toEqual([
    { command: "record_search_access", args: { rel: "Projects/Alpha.md" } },
  ]);
});

test("settings pages retain dialog focus and dismissal", async ({ page }) => {
  const trigger = page.getByRole("button", { name: /^Settings/ });
  await trigger.click();

  const dialog = page.getByRole("dialog", { name: "Settings" });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "General" }),
  ).toHaveAttribute("aria-current", "page");

  await dialog.getByRole("button", { name: "Appearance" }).click();
  await expect(dialog.getByRole("heading", { name: "Appearance" })).toBeVisible();
  await expect(dialog.getByRole("group", { name: "Theme" })).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});
