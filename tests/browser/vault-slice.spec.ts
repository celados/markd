import { expect, test } from "@playwright/test";
import { installVaultSliceFixture } from "./markd-fixture";

test("empty Untitled Note moves to Trash without stale tree or tabs", async ({
  page,
}) => {
  await installVaultSliceFixture(page);
  await page.goto("/");

  await page.getByRole("button", { name: "New note" }).click();
  const untitled = page.getByRole("treeitem", { name: "Untitled.md" });
  await expect(untitled).toBeVisible();
  await expect(page.getByRole("tab", { name: /Untitled/ })).toBeVisible();

  await untitled.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Move to Trash" }).click();
  await expect(page.getByRole("button", { name: "Settings" })).toBeEnabled();
  await expect(untitled).toHaveCount(0);
  await expect(page.getByRole("tab", { name: /Untitled/ })).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as Window & {
          __MARKD_VAULT_TEST__?: { trashCalls: string[] };
        }).__MARKD_VAULT_TEST__?.trashCalls,
      ),
    )
    .toEqual(["Untitled.md"]);
});
