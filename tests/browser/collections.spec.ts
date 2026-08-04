import { expect, test } from "@playwright/test";
import { installVaultSliceFixture } from "./riffle-fixture";

test.beforeEach(async ({ page }) => {
  await installVaultSliceFixture(page);
  await page.goto("/");
});

test("Todos and Bookmarks CRUD use the semantic Collections bridge", async ({ page }) => {
  await page.getByRole("button", { name: "Todos" }).click();
  const task = page.getByPlaceholder("Add a task…");
  await task.fill("Ship Collections");
  await task.press("Enter");
  await expect(page.getByText("Ship Collections", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Mark as done" }).click();
  await page.getByRole("button", { name: /Clear completed/ }).click();
  await expect(page.getByText("Ship Collections", { exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "Bookmarks" }).click();
  const bookmark = page.getByPlaceholder("Search bookmarks, or paste a link…");
  await bookmark.fill("example.com/read");
  await bookmark.press("Enter");
  await expect(page.getByText("example.com/read", { exact: true })).toBeVisible();
  await page.getByText("example.com/read", { exact: true }).hover();
  await page.getByRole("button", { name: "Delete bookmark" }).click();
  await expect(page.getByText("example.com/read", { exact: true })).toHaveCount(0);

  expect(await page.evaluate(() => window.riffle!.collections.snapshot())).toEqual({
    ok: true,
    value: { todos: [], todoTags: [], bookmarks: [], bookmarkTags: [] },
  });
});
