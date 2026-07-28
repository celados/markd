import { expect, test, type Page } from "@playwright/test";
import { installTauriFixture } from "./tauri-fixture";

test.beforeEach(async ({ page }) => {
  await installTauriFixture(page);
  await page.goto("/");
  await page.getByText("README.md", { exact: true }).click();
  await expect(page.locator('[data-note-editor="active"] .ProseMirror')).toBeVisible();
});

test("open tabs retain the same live editor across view switches", async ({
  page,
}) => {
  const readmeEditor = page.locator('[data-note-editor="active"] .ProseMirror');
  await readmeEditor.evaluate((element) => {
    element.setAttribute("data-editor-identity", "readme");
  });

  await page.getByRole("treeitem", { name: "Projects", exact: true }).click();
  await page.getByRole("treeitem", { name: "Alpha.md", exact: true }).click();
  await expect(page.getByRole("tab", { name: /Alpha/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.locator(".ProseMirror")).toHaveCount(2);

  await page.getByRole("button", { name: "Todos" }).click();
  await expect(page.locator(".ProseMirror")).toHaveCount(2);
  await page.getByRole("tab", { name: /README/ }).click();

  await expect(
    page.locator('[data-note-editor="active"] .ProseMirror'),
  ).toHaveAttribute("data-editor-identity", "readme");
});

test("autosave and close flush preserve frontmatter and the owning path", async ({
  page,
}) => {
  await clearCommands(page);
  const editor = page.locator('[data-note-editor="active"] .ProseMirror');
  await editor.click();
  await page.keyboard.press("End");
  await page.keyboard.type(" autosaved");

  await expect
    .poll(() => latestWrite(page, "README.md"))
    .toContain("autosaved");
  await expect
    .poll(() => latestWrite(page, "README.md"))
    .toContain("---\nfixture: preserved\n---");

  await page.getByRole("treeitem", { name: "Projects", exact: true }).click();
  await page.getByRole("treeitem", { name: "Alpha.md", exact: true }).click();
  await page.getByRole("tab", { name: /README/ }).click();
  await editor.click();
  await page.keyboard.press("End");
  await page.keyboard.type(" flushed-on-close");
  await page.getByRole("button", { name: "Close README" }).click();

  await expect
    .poll(() => latestWrite(page, "README.md"))
    .toContain("flushed-on-close");
});

test("markdown source and rich editor round-trip through one note model", async ({
  page,
}) => {
  await page
    .getByRole("button", { name: "Show Markdown source" })
    .click();
  const source = page.locator(".cm-content");
  await expect(source).toBeVisible();
  await expect(source).toContainText("fixture: preserved");

  await page.locator(".cm-line").last().click();
  await page.keyboard.press("End");
  await page.keyboard.type("\n\nSource round trip", { delay: 25 });
  await page.getByRole("button", { name: "Show rich editor" }).click();

  const rich = page.locator('[data-note-editor="active"] .ProseMirror');
  await expect(rich).toContainText("Source round trip");
  await page
    .getByRole("button", { name: "Show Markdown source" })
    .click();
  await expect(page.locator(".cm-content")).toContainText("Source round trip");
});

test("slash commands hand off to the note-link picker without losing focus", async ({
  page,
}) => {
  const editor = page.locator('[data-note-editor="active"] .ProseMirror');
  await editor.click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("/");

  await expect(page.getByRole("button", { name: "Link to note" })).toBeVisible();
  await page.keyboard.press("Enter");

  const picker = page.getByPlaceholder("Link to note…");
  await expect(picker).toBeFocused();
  await picker.fill("Alpha");
  await page.keyboard.press("Enter");

  await expect(editor.getByRole("link", { name: "Alpha" })).toHaveAttribute(
    "href",
    "Projects/Alpha.md",
  );
});

test("find and replace keeps the editor mounted and updates the document", async ({
  page,
}) => {
  const editor = page.locator('[data-note-editor="active"] .ProseMirror');
  await editor.click();
  await page.keyboard.press("ControlOrMeta+f");

  const find = page.getByRole("searchbox", { name: "Find in note" });
  await expect(find).toBeFocused();
  await find.fill("verification");
  await expect(page.getByText("1 of 1", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Show replace" }).click();
  const replacement = page.getByRole("textbox", { name: "Replace with" });
  await replacement.fill("migration");
  await page.getByRole("button", { name: "Replace All" }).click();
  await expect(editor).toContainText("Octane + pnpm migration.");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(find).toHaveCount(0);
});

test("selection formatting preserves the selected text", async ({ page }) => {
  const paragraph = page
    .locator('[data-note-editor="active"] .ProseMirror p')
    .filter({ hasText: "Octane + pnpm verification." });
  await paragraph.click();
  await page.keyboard.press("Home");
  await page.keyboard.down("Shift");
  await page.keyboard.press("End");
  await page.keyboard.up("Shift");

  const bold = page.getByRole("button", { name: "Bold" });
  await expect(bold).toBeVisible();
  await bold.click();
  await expect(paragraph.locator("strong")).toHaveText(
    "Octane + pnpm verification.",
  );
});

async function clearCommands(page: Page) {
  await page.evaluate(() => {
    const fixture = (
      window as unknown as {
        __MARKD_TEST__: { commands: unknown[] };
      }
    ).__MARKD_TEST__;
    fixture.commands.length = 0;
  });
}

async function latestWrite(page: Page, rel: string) {
  return page.evaluate((targetRel) => {
    const fixture = (
      window as unknown as {
        __MARKD_TEST__: {
          commands: Array<{
            command: string;
            args: Record<string, unknown>;
          }>;
        };
      }
    ).__MARKD_TEST__;
    const writes = fixture.commands.filter(
      (entry) =>
        entry.command === "write_note" && String(entry.args.rel) === targetRel,
    );
    return String(writes.at(-1)?.args.content ?? "");
  }, rel);
}
