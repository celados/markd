import { expect, test, type Page } from "@playwright/test";
import { installTauriFixture } from "./tauri-fixture";

test.beforeEach(async ({ page }) => {
  await installTauriFixture(page);
  await page.goto("/");
  await page.getByRole("treeitem", { name: "README.md" }).click();
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

test("the rich editor receives only the body and resolves long YAML values", async ({
  page,
}) => {
  await page.evaluate(() => {
    const fixture = (
      window as Window & {
        __MARKD_TEST__: { notes: Map<string, string> };
      }
    ).__MARKD_TEST__;
    fixture.notes.set(
      "README.md",
      "---\nfixture: preserved\nsummary: >-\n  A long field value loaded through the semantic Electron bridge.\n---\n# README\n\nOctane + pnpm verification.",
    );
    window.dispatchEvent(new Event("focus"));
  });

  const editor = page.locator('[data-note-editor="active"] .ProseMirror');
  await expect(editor).toContainText("Octane + pnpm verification.");
  await expect(editor).not.toContainText("fixture: preserved");
  await expect(page.getByLabel("summary value")).toHaveValue(
    "A long field value loaded through the semantic Electron bridge.",
  );

  const longValue =
    "This replacement is deliberately longer than a normal YAML wrapping width and must remain a property value instead of turning into a visible greater-than marker.";
  await page.getByLabel("summary value").fill(longValue);
  await page.getByLabel("summary value").press("Enter");

  await expect.poll(() => latestWrite(page, "README.md")).toContain(longValue);
  await expect.poll(() => latestWrite(page, "README.md")).not.toContain(
    "summary: >",
  );
});

test("dirty editor wins an external-change conflict and selection survives tabs", async ({
  page,
}) => {
  const editor = page.locator('[data-note-editor="active"] .ProseMirror');
  await editor.click();
  await page.keyboard.press("End");
  await page.keyboard.type(" local draft");
  await page.evaluate(() => {
    const fixture = (
      window as Window & {
        __MARKD_TEST__: { notes: Map<string, string> };
      }
    ).__MARKD_TEST__;
    fixture.notes.set("README.md", "# External replacement");
    window.dispatchEvent(new Event("focus"));
  });

  await expect(editor).toContainText("local draft");
  for (let index = 0; index < "draft".length; index += 1) {
    await page.keyboard.press("Shift+ArrowLeft");
  }
  await page.getByRole("treeitem", { name: "Projects", exact: true }).click();
  await page.getByRole("treeitem", { name: "Alpha.md", exact: true }).click();
  await page.getByRole("tab", { name: /README/ }).click();
  await editor.focus();
  await page.keyboard.type("kept");
  await expect(editor).toContainText("local kept");
  await expect.poll(() => latestWrite(page, "README.md")).toContain("local kept");
});

test("clean editor reloads an external body without exposing its frontmatter", async ({
  page,
}) => {
  await page.evaluate(() => {
    const fixture = (
      window as Window & {
        __MARKD_TEST__: { notes: Map<string, string> };
      }
    ).__MARKD_TEST__;
    fixture.notes.set(
      "README.md",
      "---\nsource: external\n---\n# Reloaded\n\nClean disk change.",
    );
    window.dispatchEvent(new Event("focus"));
  });

  const editor = page.locator('[data-note-editor="active"] .ProseMirror');
  await expect(editor).toContainText("Clean disk change.");
  await expect(editor).not.toContainText("source: external");
  await expect(page.getByLabel("source value")).toHaveValue("external");
});

test("rich body edits do not author frontmatter", async ({ page }) => {
  await page.getByRole("treeitem", { name: "Projects", exact: true }).click();
  await page.getByRole("treeitem", { name: "Alpha.md", exact: true }).click();
  const editor = page.locator('[data-note-editor="active"] .ProseMirror');
  await editor.click();
  await page.keyboard.press("End");
  await page.keyboard.type(" body only");

  await expect
    .poll(() => latestWrite(page, "Projects/Alpha.md"))
    .toContain("body only");
  await expect
    .poll(() => latestWrite(page, "Projects/Alpha.md"))
    .not.toMatch(/^---/);
});

test("tab context menu manages tabs, pins, and both path forms", async ({
  page,
}) => {
  await page.getByRole("treeitem", { name: "Projects", exact: true }).click();
  await page.getByRole("treeitem", { name: "Alpha.md", exact: true }).click();
  const readmeTab = page.getByRole("tab", { name: /README/ });

  await readmeTab.click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "Pin note" })).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: "Close", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Close others" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Copy path" })).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: "Copy relative path" }),
  ).toBeVisible();

  await page.getByRole("menuitem", { name: "Pin note" }).click();
  await readmeTab.click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "Unpin note" })).toBeVisible();
  await page.getByRole("menuitem", { name: "Copy path" }).click();
  await expect
    .poll(() => clipboardText(page))
    .toBe("/private/tmp/markd-browser-fixture/README.md");

  await readmeTab.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Copy relative path" }).click();
  await expect.poll(() => clipboardText(page)).toBe("README.md");

  await readmeTab.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Close others" }).click();
  await expect(page.getByRole("tab")).toHaveCount(1);
  await expect(readmeTab).toHaveAttribute("aria-selected", "true");
});

test("tab strip blank space is draggable while tabs and menus stay interactive", async ({
  page,
}) => {
  const blank = page.locator("[data-tab-strip-drag-region]");
  await expect(blank).toHaveCSS("-webkit-app-region", "drag");
  await expect(page.locator("[data-markd-drag-region]").first()).toHaveCSS(
    "-webkit-app-region",
    "drag",
  );
  await expect(page.getByRole("tab", { name: /README/ })).toHaveCSS(
    "-webkit-app-region",
    "no-drag",
  );

  await page.getByRole("tab", { name: /README/ }).click({ button: "right" });
  await expect(page.getByRole("menu")).toHaveCSS(
    "-webkit-app-region",
    "no-drag",
  );
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
  await page.keyboard.insertText("\n\nSource round trip");
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

async function clipboardText(page: Page) {
  return page.evaluate(() => {
    const fixture = (
      window as unknown as {
        __MARKD_TEST__: { clipboard: string[] };
      }
    ).__MARKD_TEST__;
    return fixture.clipboard.at(-1);
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
