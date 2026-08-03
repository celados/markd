import { expect, test } from "@playwright/test";
import { installDesktopFixture } from "./desktop-fixture";

test.beforeEach(async ({ page }) => {
  await installDesktopFixture(page, { taggedTodos: true });
  await page.goto("/");
  await page.getByRole("button", { name: /^Todos/ }).click();
});

test("tag controls preserve filtering and destructive confirmation", async ({
  page,
}) => {
  await expect(page.getByText("Ship Octane port", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Review visual polish", { exact: true }),
  ).toBeVisible();

  await page.getByRole("button", { name: "#work" }).click();
  await expect(
    page.getByText("Review visual polish", { exact: true }),
  ).toHaveCount(0);

  await page.getByRole("button", { name: "Remove work" }).click();
  await expect(page.getByText("No tasks tagged #work.")).toBeVisible();

  await page.getByRole("button", { name: "All" }).click();
  await page.getByRole("button", { name: "Assign tags" }).first().click();
  await page.getByRole("button", { name: "later", exact: true }).click();
  await expect(page.getByRole("button", { name: "#later" })).toHaveCount(2);

  await page.getByRole("button", { name: "Delete tag later" }).click();
  const dialog = page.getByRole("dialog", { name: "Delete tag" });
  await expect(dialog).toBeVisible();
  await expect(page.getByText("Delete #later?")).toBeVisible();
  await expect(dialog).toContainText(
    "2 items tagged #later will be untagged. This can’t be undone.",
  );
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("dialog", { name: "Delete tag" })).toHaveCount(0);
});
