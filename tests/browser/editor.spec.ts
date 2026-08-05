import { expect, test, type Locator, type Page } from "@playwright/test";
import { installDesktopFixture } from "./desktop-fixture";

test.beforeEach(async ({ page }) => {
  await installDesktopFixture(page);
  await page.goto("/");
  await page.getByRole("treeitem", { name: "README.md" }).click();
  await expect(
    page.locator('[data-note-editor="active"] [data-readonly-markdown="true"]'),
  ).toBeVisible();
});

test("open tabs retain the same live Note pane across view switches", async ({
  page,
}) => {
  const readmePane = page.locator('[data-note-editor="active"]');
  await readmePane.evaluate((element) => {
    element.setAttribute("data-pane-identity", "readme");
  });

  await page.getByRole("treeitem", { name: "Projects", exact: true }).click();
  await page.getByRole("treeitem", { name: "Alpha.md", exact: true }).click();
  await expect(page.getByRole("tab", { name: /Alpha/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.locator('[data-readonly-markdown="true"]')).toHaveCount(2);

  await page.getByRole("button", { name: "Todos" }).click();
  await expect(page.locator('[data-readonly-markdown="true"]')).toHaveCount(2);
  await page.getByRole("tab", { name: /README/ }).click();

  await expect(page.locator('[data-note-editor="active"]')).toHaveAttribute(
    "data-pane-identity",
    "readme",
  );
});

test("Readonly View receives only the body and resolves long YAML values", async ({
  page,
}) => {
  await page.evaluate(() => {
    const fixture = (
      window as Window & {
        __RIFFLE_TEST__: { notes: Map<string, string> };
      }
    ).__RIFFLE_TEST__;
    fixture.notes.set(
      "README.md",
      "---\nfixture: preserved\nsummary: >-\n  A long field value loaded through the semantic Electron bridge.\n---\n# README\n\nOctane + pnpm verification.",
    );
    window.dispatchEvent(new Event("focus"));
  });

  const view = page.locator('[data-note-editor="active"] .prose-note');
  await expect(view).toContainText("Octane + pnpm verification.");
  await expect(view).not.toContainText("fixture: preserved");
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

test("dirty Source Editor wins an external-change conflict across tabs", async ({
  page,
}) => {
  const source = await openSource(page);
  await appendToSource(page, source, " local draft");
  await page.evaluate(() => {
    const fixture = (
      window as Window & {
        __RIFFLE_TEST__: { notes: Map<string, string> };
      }
    ).__RIFFLE_TEST__;
    fixture.notes.set("README.md", "# External replacement");
    window.dispatchEvent(new Event("focus"));
  });

  await expect(source).toContainText("local draft");
  await page.getByRole("treeitem", { name: "Projects", exact: true }).click();
  await page.getByRole("treeitem", { name: "Alpha.md", exact: true }).click();
  await page.getByRole("tab", { name: /README/ }).click();
  await expect(page.locator('[data-note-editor="active"] .cm-content')).toContainText(
    "local draft",
  );
});

test("clean Readonly View reloads an external body without exposing frontmatter", async ({
  page,
}) => {
  await page.evaluate(() => {
    const fixture = (
      window as Window & {
        __RIFFLE_TEST__: { notes: Map<string, string> };
      }
    ).__RIFFLE_TEST__;
    fixture.notes.set(
      "README.md",
      "---\nsource: external\n---\n# Reloaded\n\nClean disk change.",
    );
    window.dispatchEvent(new Event("focus"));
  });

  const view = page.locator('[data-note-editor="active"] .prose-note');
  await expect(view).toContainText("Clean disk change.");
  await expect(view).not.toContainText("source: external");
  await expect(page.getByLabel("source value")).toHaveValue("external");
});

test("Source Editor body edits do not author frontmatter", async ({ page }) => {
  await page.getByRole("treeitem", { name: "Projects", exact: true }).click();
  await page.getByRole("treeitem", { name: "Alpha.md", exact: true }).click();
  const source = await openSource(page);
  await appendToSource(page, source, " body only");

  await expect.poll(() => latestWrite(page, "Projects/Alpha.md")).toContain(
    "body only",
  );
  await expect.poll(() => latestWrite(page, "Projects/Alpha.md")).not.toMatch(
    /^---/,
  );
});

test("tab context menu manages tabs, pins, and both path forms", async ({
  page,
}) => {
  await page.getByRole("treeitem", { name: "Projects", exact: true }).click();
  await page.getByRole("treeitem", { name: "Alpha.md", exact: true }).click();
  const readmeTab = page.getByRole("tab", { name: /README/ });

  await readmeTab.click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "Pin note" })).toBeVisible();
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
    .toBe("/private/tmp/riffle-browser-fixture/README.md");

  await readmeTab.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Copy relative path" }).click();
  await expect.poll(() => clipboardText(page)).toBe("README.md");
});

test("tab strip blank space is draggable while tabs and menus stay interactive", async ({
  page,
}) => {
  const blank = page.locator("[data-tab-strip-drag-region]");
  await expect(blank).toHaveCSS("-webkit-app-region", "drag");
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

test("Source Editor autosave and close flush preserve frontmatter and path", async ({
  page,
}) => {
  await clearCommands(page);
  const source = await openSource(page);
  await appendToSource(page, source, " autosaved");

  await expect.poll(() => latestWrite(page, "README.md")).toContain("autosaved");
  await expect.poll(() => latestWrite(page, "README.md")).toContain(
    "---\nfixture: preserved\n---",
  );

  await appendToSource(page, source, " flushed-on-close");
  await page.getByRole("button", { name: "Close README" }).click();
  await expect.poll(() => latestWrite(page, "README.md")).toContain(
    "flushed-on-close",
  );
});

test("Source Editor changes refresh the Readonly View", async ({ page }) => {
  const source = await openSource(page);
  await appendToSource(page, source, "\n\n## Source update");
  await page.getByRole("button", { name: "Show Readonly View" }).click();

  await expect(
    page.getByRole("heading", { name: "Source update" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Show Markdown source" }).click();
  await expect(page.locator(".cm-content")).toContainText("Source update");
});

test("Source Editor find and replace remains available", async ({ page }) => {
  const source = await openSource(page);
  await source.click();
  await page.keyboard.press("ControlOrMeta+f");

  const find = page.getByRole("searchbox", { name: "Find in note" });
  await expect(find).toBeFocused();
  await find.fill("verification");
  await expect(page.getByText("1 of 1", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Show replace" }).click();
  await page.getByRole("textbox", { name: "Replace with" }).fill("migration");
  await page.getByRole("button", { name: "Replace All" }).click();
  await expect(source).toContainText("Octane + pnpm migration.");
  await expect.poll(() => latestWrite(page, "README.md")).toContain("migration");
});

async function openSource(page: Page): Promise<Locator> {
  await page.getByRole("button", { name: "Show Markdown source" }).click();
  const source = page.locator('[data-note-editor="active"] .cm-content');
  await expect(source).toBeVisible();
  return source;
}

async function appendToSource(page: Page, source: Locator, text: string) {
  await source.locator(".cm-line").last().click();
  await page.keyboard.press("End");
  await page.keyboard.insertText(text);
}

async function clearCommands(page: Page) {
  await page.evaluate(() => {
    const fixture = (
      window as unknown as {
        __RIFFLE_TEST__: { operations: unknown[] };
      }
    ).__RIFFLE_TEST__;
    fixture.operations.length = 0;
  });
}

async function clipboardText(page: Page) {
  return page.evaluate(() => {
    const fixture = (
      window as unknown as {
        __RIFFLE_TEST__: { clipboard: string[] };
      }
    ).__RIFFLE_TEST__;
    return fixture.clipboard.at(-1);
  });
}

async function latestWrite(page: Page, rel: string) {
  return page.evaluate((targetRel) => {
    const fixture = (
      window as unknown as {
        __RIFFLE_TEST__: {
          operations: Array<{
            method: string;
            params: Record<string, unknown>;
          }>;
        };
      }
    ).__RIFFLE_TEST__;
    const writes = fixture.operations.filter(
      (entry) =>
        entry.method === "vault.notes.write" &&
        String(entry.params.rel) === targetRel,
    );
    return String(writes.at(-1)?.params.content ?? "");
  }, rel);
}
