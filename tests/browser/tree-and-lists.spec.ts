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

test("nested row wins over the root drop zone", async ({ page }) => {
  await page.getByRole("treeitem", { name: "Projects" }).click();
  const source = page.getByRole("treeitem", { name: "Alpha.md" });
  const target = page.getByRole("treeitem", { name: "Archive" });
  const sourceBox = await source.boundingBox();
  const targetBox = await target.boundingBox();
  if (!sourceBox || !targetBox) throw new Error("Tree rows must have layout boxes");

  await page.mouse.move(sourceBox.x + 20, sourceBox.y + sourceBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(sourceBox.x + 35, sourceBox.y + sourceBox.height / 2, {
    steps: 3,
  });
  await page.mouse.move(targetBox.x + 20, targetBox.y + targetBox.height / 2, {
    steps: 8,
  });
  await page.mouse.up();

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
});
