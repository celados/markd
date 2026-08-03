import { expect, test } from "@playwright/test";
import { installDesktopFixture } from "./desktop-fixture";

test("account and Published Share lifecycle use the semantic Cloud bridge", async ({ page }) => {
  await installDesktopFixture(page, { cloudLifecycle: true });
  await page.goto("/");

  await page.keyboard.press("ControlOrMeta+,");
  const settings = page.getByRole("dialog", { name: "Settings" });
  await settings.getByRole("button", { name: "Markd Cloud" }).click();
  await settings.getByRole("button", { name: "Sign in" }).click();
  await settings.getByLabel("Email address").fill("reader@example.test");
  await settings.getByRole("button", { name: "Send code" }).click();
  await settings.getByLabel("Six-digit verification code").fill("123456");
  await settings.getByRole("button", { name: "Verify", exact: true }).click();
  await expect(settings.getByText("reader@example.test")).toBeVisible();
  await expect(settings.getByText("Active", { exact: true })).toBeVisible();
  await settings.getByRole("button", { name: "Manage billing" }).click();
  await expect.poll(() => page.evaluate(() => (
    window as Window & { __MARKD_TEST__: { openedExternalUrls: string[] } }
  ).__MARKD_TEST__.openedExternalUrls)).toEqual(["https://example.test/billing"]);

  await page.keyboard.press("Escape");
  await page.getByRole("treeitem", { name: "README.md" }).click();
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  const publishing = page.getByRole("dialog", { name: "Publish note site on the web" });
  await expect(publishing.getByRole("button", { name: "Publish site" })).toBeVisible();
  await publishing.getByRole("button", { name: "Publish site" }).click();
  await expect(publishing.getByText("Published", { exact: true })).toBeVisible();
  await publishing.getByRole("button", { name: "Update site" }).click();
  await expect(publishing.getByText("Published", { exact: true })).toBeVisible();
  await publishing.getByRole("button", { name: "Unpublish" }).click();
  await expect(publishing.getByRole("button", { name: "Publish site" })).toBeVisible();
});

test("remote sign-out failure does not leave the renderer signed in", async ({ page }) => {
  await installDesktopFixture(page, {
    cloudLifecycle: true,
    cloudSignOutFailure: true,
  });
  await page.goto("/");
  await page.keyboard.press("ControlOrMeta+,");
  const settings = page.getByRole("dialog", { name: "Settings" });
  await settings.getByRole("button", { name: "Markd Cloud" }).click();
  await settings.getByRole("button", { name: "Sign in" }).click();
  await settings.getByLabel("Email address").fill("reader@example.test");
  await settings.getByRole("button", { name: "Send code" }).click();
  await settings.getByLabel("Six-digit verification code").fill("123456");
  await settings.getByRole("button", { name: "Verify", exact: true }).click();

  await settings.getByRole("button", { name: "Sign out" }).click();
  await expect(settings.getByText("Not signed in", { exact: true })).toBeVisible();
  await expect(settings.getByRole("alert")).toContainText("Remote sign-out failed.");
});
