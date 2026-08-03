import { expect, test } from "@playwright/test";
import { installTauriFixture } from "./tauri-fixture";

test.beforeEach(async ({ page }) => {
  await installTauriFixture(page);
  await page.goto("/");
});

test("tree keyboard navigation is not captured by drag sensors", async ({ page }) => {
  const readme = page.getByRole("treeitem", { name: "README.md" });
  const projects = page.getByRole("treeitem", { name: "Projects" });

  await readme.focus();
  await page.keyboard.press("ArrowDown");
  await expect(projects).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(projects).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("treeitem", { name: "Alpha.md" })).toBeVisible();
});

test("large Vaults virtualize rows while preserving End navigation", async ({ page }) => {
  await installTauriFixture(page, { largeTreeSize: 1_000 });
  await page.goto("/");

  const tree = page.getByRole("tree", { name: "Notes", exact: true });
  const rows = tree.getByRole("treeitem");
  await expect(page.locator("[data-note-tree]")).toHaveAttribute(
    "data-file-tree-virtualized",
    "true",
  );
  expect(await rows.count()).toBeLessThan(80);

  await rows.first().focus();
  await page.keyboard.press("End");
  await expect(page.getByRole("treeitem", { name: "Note 0999.md" })).toBeFocused();
  expect(await rows.count()).toBeLessThan(80);
});

test("failed rename restores canonical disk projection", async ({ page }) => {
  await installTauriFixture(page, { mutationFailure: true });
  await page.goto("/");

  const readme = page.getByRole("treeitem", { name: "README.md" });
  await readme.focus();
  await page.keyboard.press("F2");
  const rename = page.getByRole("textbox", { name: "Rename README.md" });
  await rename.fill("Guide.md");
  await rename.press("Enter");

  await expect(page.getByRole("treeitem", { name: "README.md" })).toBeVisible();
  await expect(page.getByRole("treeitem", { name: "Guide.md" })).toHaveCount(0);
  await expect(page.getByText("Rename rejected by disk")).toBeVisible();
});

test("nested row wins over the root drop zone", async ({ page }) => {
  await page.getByRole("treeitem", { name: "Projects" }).click();
  const source = page.getByRole("treeitem", { name: "Alpha.md" });
  const target = page.getByRole("treeitem", { name: "Archive" });
  // Trees uses the browser's native HTML drag lifecycle rather than pointer
  // sensors, so Playwright must dispatch a real drag gesture as Chrome does.
  await source.dragTo(target);

  await expect
    .poll(() =>
      page.evaluate(() => {
        const state = window as Window & {
          __MARKD_TEST__?: {
            commands: Array<{
              command: string;
              args: Record<string, unknown>;
            }>;
          };
        };
        return state.__MARKD_TEST__?.commands.filter(
          ({ command }) => command === "move_entry",
        );
      }),
    )
    .toEqual([
      {
        command: "move_entry",
        args: { rel: "Projects/Alpha.md", dir: "Archive" },
      },
    ]);
  await expect(page.getByRole("treeitem", { name: "Alpha.md" })).toHaveAttribute(
    "data-item-path",
    "Archive/Alpha.md",
  );
});

test("failed drag does not remain optimistically moved", async ({ page }) => {
  await installTauriFixture(page, { mutationFailure: true });
  await page.goto("/");
  await page.getByRole("treeitem", { name: "Projects" }).click();
  const source = page.getByRole("treeitem", { name: "Alpha.md" });
  await source.dragTo(page.getByRole("treeitem", { name: "Archive" }));

  await expect(source).toHaveAttribute("data-item-path", "Projects/Alpha.md");
  await expect(source).toHaveAttribute("aria-selected", "true");
  await expect(source).toBeFocused();
  await expect(page.getByRole("treeitem", { name: "Projects" })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await expect(page.getByText("Move rejected by disk")).toBeVisible();
});

test("disk collision suffix wins over the optimistic drop path", async ({ page }) => {
  await installTauriFixture(page, { mutationCollision: true });
  await page.goto("/");
  await page.getByRole("treeitem", { name: "Projects" }).click();
  await page
    .getByRole("treeitem", { name: "Alpha.md" })
    .dragTo(page.getByRole("treeitem", { name: "Archive" }));

  const persisted = page.getByRole("treeitem", { name: "Alpha 2.md" });
  await expect(persisted).toHaveAttribute("data-item-path", "Archive/Alpha 2.md");
  await expect(persisted).toHaveAttribute("aria-selected", "true");
  await expect(persisted).toBeFocused();
  await expect(page.getByRole("treeitem", { name: "Archive" })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await expect(page.getByRole("treeitem", { name: "Alpha.md" })).toHaveCount(0);
});

test("pinned folders own their subtree without duplicating the main tree", async ({
  page,
}) => {
  await installTauriFixture(page, { pinnedFolder: true });
  await page.goto("/");

  const pinnedTree = page.getByRole("tree", {
    name: "Pinned notes and folders",
  });
  const mainTree = page.getByRole("tree", { name: "Notes", exact: true });
  await expect(pinnedTree.getByRole("treeitem", { name: "Projects" })).toBeVisible();
  await expect(mainTree.getByRole("treeitem", { name: "Projects" })).toHaveCount(0);

  await pinnedTree.getByRole("treeitem", { name: "Projects" }).click();
  await expect(
    pinnedTree.getByRole("treeitem", { name: "Alpha.md" }),
  ).toBeVisible();

  const unpin = pinnedTree.getByRole("button", {
    name: "Unpin Projects folder",
  });
  await page.mouse.move(1000, 700);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await expect(unpin).toHaveCSS("opacity", "0");
  await pinnedTree.getByRole("treeitem", { name: "Projects" }).hover();
  await expect(unpin).toHaveCSS("opacity", "0.6");
  await unpin.click();
  await expect(pinnedTree).toHaveCount(0);
});

test("stale Pins stay visible and can be explicitly removed", async ({ page }) => {
  await installTauriFixture(page, { stalePin: "Gone.md" });
  await page.goto("/");

  const pinnedTree = page.getByRole("tree", {
    name: "Pinned notes and folders",
  });
  const missing = pinnedTree.getByRole("treeitem", { name: /Gone\.md Missing/ });
  await expect(missing).toHaveAttribute("data-status", "stale");
  const unpin = missing.getByRole("button", { name: "Unpin missing Gone.md" });
  await missing.hover();
  await expect(unpin).toHaveCSS("opacity", "0.6");
  await unpin.click();
  await expect(pinnedTree).toHaveCount(0);
});
