import { expect, test } from "@playwright/test";
import { installDesktopFixture } from "./desktop-fixture";

test.beforeEach(async ({ page }) => {
  await installDesktopFixture(page);
  await page.goto("/");
  await page.getByRole("treeitem", { name: "README.md" }).click();
});

test("a Note opens as baseline Markdown without exposing frontmatter", async ({
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
      [
        "---",
        "fixture: hidden",
        "---",
        "# Readonly heading",
        "",
        "Soft first line",
        "soft second line with **strong**, *emphasis*, and ~~strike~~.",
        "",
        "> Quoted text",
        "",
        "- Bullet",
        "- [x] Complete task",
        "",
        "3. Third item",
        "",
        "![Diagram](https://tracker.invalid/pixel.png)",
        "",
        "| Name | Value |",
        "| :---: | ---: |",
        "| Riffle | Markdown |",
        "",
        "```ts",
        "const answer = 42;",
        "```",
      ].join("\n"),
    );
    window.dispatchEvent(new Event("focus"));
  });

  const view = page.locator('[data-readonly-markdown="true"]');
  await expect(view).toBeVisible();
  await expect(view.getByRole("heading", { name: "Readonly heading" })).toBeVisible();
  await expect(view.locator("strong")).toHaveText("strong");
  await expect(view.locator("em")).toHaveText("emphasis");
  await expect(view.locator("del")).toHaveText("strike");
  await expect(view.getByText("Quoted text")).toHaveCount(1);
  await expect(view.getByRole("cell", { name: "Markdown" })).toBeVisible();
  await expect(view.locator('li input[type="checkbox"]')).toBeDisabled();
  await expect(view.locator("ol")).toHaveAttribute("start", "3");
  const image = view.getByRole("img", { name: "Diagram" });
  await expect(image).toHaveAttribute(
    "data-markdown-src",
    "https://tracker.invalid/pixel.png",
  );
  await expect(image).not.toHaveAttribute("src", /.+/);
  await expect(view.getByRole("columnheader", { name: "Name" })).toHaveCSS(
    "text-align",
    "center",
  );
  await expect(view.locator("pre code")).toContainText("const answer = 42;");
  await expect(view).not.toContainText("fixture: hidden");

  const softBreakParagraph = view.locator("p").filter({
    hasText: "Soft first line",
  });
  await expect(softBreakParagraph).toHaveCount(1);
  await expect(softBreakParagraph.locator("br")).toHaveCount(1);
});

test("a render failure leaves source reachable and recoverable", async ({
  page,
}) => {
  const brokenSource = [
    "---",
    "fixture: preserved",
    "---",
    "::unsupported",
    "Cannot be projected",
    "::",
  ].join("\n");
  await page.evaluate((source) => {
    const fixture = (
      window as Window & {
        __RIFFLE_TEST__: { notes: Map<string, string> };
      }
    ).__RIFFLE_TEST__;
    fixture.notes.set("README.md", source);
    window.dispatchEvent(new Event("focus"));
  }, brokenSource);

  const error = page.getByRole("alert");
  await expect(error).toContainText("Markdown rendering failed");
  await expect(error).toContainText("Comark components are not Riffle Markdown");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const fixture = (
          window as Window & {
            __RIFFLE_TEST__: { notes: Map<string, string> };
          }
        ).__RIFFLE_TEST__;
        return fixture.notes.get("README.md");
      }),
    )
    .toBe(brokenSource);

  await page.getByRole("button", { name: "Show Markdown source" }).click();
  const source = page.locator(".cm-content");
  await expect(source).toContainText("::unsupported");
  await source.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText(
    "---\nfixture: preserved\n---\n# Recovered through source",
  );

  await page.getByRole("button", { name: "Show Readonly View" }).click();
  await expect(
    page.getByRole("heading", { name: "Recovered through source" }),
  ).toBeVisible();
});

test("Riffle links and Vault assets produce semantic desktop intents", async ({
  page,
}) => {
  await replaceNote(
    page,
    [
      "# Product links",
      "",
      "[[Alpha|Wiki alias]]",
      "",
      "[Nested Note](Projects/Alpha.md)",
      "",
      "[Missing Note](Missing.md)",
      "",
      "[External](https://example.com/docs)",
      "",
      "![Vault diagram](.markd/assets/fixture.png)",
    ].join("\n"),
  );

  const view = page.locator('[data-readonly-markdown="true"]');
  const wiki = view.getByRole("link", { name: "Wiki alias" });
  const nested = view.getByRole("link", { name: "Nested Note" });
  const missing = view.getByText("Missing Note", { exact: true });
  await expect(wiki).toHaveAttribute("data-note-rel", "Projects/Alpha.md");
  await expect(wiki).toHaveAttribute("href", "Projects/Alpha.md");
  await expect(nested).toHaveAttribute("data-note-rel", "Projects/Alpha.md");
  await expect(nested).toHaveAttribute("href", "Projects/Alpha.md");
  await expect(missing).toHaveAttribute("data-note-status", "missing");
  await expect(missing).toHaveAttribute("aria-disabled", "true");
  await expect(missing).not.toHaveAttribute("href", /.+/);

  await missing.click();
  await expect(page.getByRole("heading", { name: "Product links" })).toBeVisible();

  await view.getByRole("link", { name: "External" }).click();
  await expect
    .poll(() => openedExternalUrls(page))
    .toEqual(["https://example.com/docs"]);
  await expect(page).toHaveURL(/127\.0\.0\.1:4173/);

  await expect(view.getByRole("img", { name: "Vault diagram" })).toHaveAttribute(
    "src",
    "riffle-asset://vault/fixture.png",
  );
  await expect
    .poll(() => noteSource(page, "README.md"))
    .toContain("[[Alpha|Wiki alias]]");

  await wiki.click();
  await expect(page.getByRole("heading", { name: "Alpha" })).toBeVisible();
});

test("nested relative Note links stay inside the Vault", async ({ page }) => {
  await page.getByRole("treeitem", { name: "Projects", exact: true }).click();
  await page.getByRole("treeitem", { name: "Alpha.md", exact: true }).click();
  await replaceNote(
    page,
    "[Parent Note](../README.md) [Encoded escape](%252e%252e/%252e%252e/outside.md)",
    "Projects/Alpha.md",
  );

  const view = page.locator('[data-note-editor="active"] [data-readonly-markdown="true"]');
  const parent = view.getByRole("link", { name: "Parent Note" });
  await expect(parent).toHaveAttribute("data-note-rel", "README.md");
  const escape = view.getByText("Encoded escape", { exact: true });
  await expect(escape).toHaveAttribute("data-link-status", "rejected");
  await expect(escape).not.toHaveAttribute("href", /.+/);

  await escape.click();
  await expect(
    page.locator('[data-note-editor="active"] [data-source-rel="Projects/Alpha.md"]'),
  ).toBeVisible();
  await parent.click();
  await expect(page.getByRole("heading", { name: "README" })).toBeVisible();
});

test("accepted Embedded Markup renders as inert document structure", async ({
  page,
}) => {
  await replaceNote(
    page,
    [
      '<section aria-label="Release status">',
      "<details open>",
      "<summary>Details</summary>",
      "<mark>你好 🧭 ready</mark>",
      "</details>",
      "</section>",
    ].join("\n"),
  );

  const region = page.getByRole("region", { name: "Release status" });
  await expect(region.locator("details")).toHaveAttribute("open", "");
  await expect(region.locator("summary")).toHaveText("Details");
  await expect(region.locator("mark")).toHaveText("你好 🧭 ready");
});

test("component-looking syntax remains literal inside code", async ({ page }) => {
  await replaceNote(
    page,
    [
      "Inline `:section foo` stays code.",
      "",
      "```md",
      "::section",
      "literal example",
      "::",
      "```",
    ].join("\n"),
  );

  const view = page.locator('[data-readonly-markdown="true"]');
  await expect(view.locator("p code")).toHaveText(":section foo");
  await expect(view.locator("pre code")).toContainText("::section");
  await expect(page.getByRole("alert")).toHaveCount(0);
});

const rejectedEmbeddedMarkup = [
  ["script", "<script>window.__RIFFLE_MARKUP_EXECUTED__ = Boolean(window.riffle)</script>"],
  ["event handler", '<section onclick="window.riffle">unsafe</section>'],
  ["privileged embed", '<iframe src="https://tracker.invalid"></iframe>'],
  ["SVG execution", "<svg><script>alert(1)</script></svg>"],
  ["component syntax disguised as markup", "::section\nNot HTML\n::"],
] as const;

for (const [name, markdown] of rejectedEmbeddedMarkup) {
  test(`Embedded Markup rejects ${name} before mounting content`, async ({
    page,
  }) => {
    await replaceNote(page, markdown);

    await expect(page.getByRole("alert")).toContainText(
      /Unsupported Embedded Markup|Unsupported Markdown attribute|Comark components are not Riffle Markdown/,
    );
    await expect(page.locator('[data-note-editor="active"] iframe')).toHaveCount(0);
    expect(
      await page.evaluate(() =>
        (window as Window & { __RIFFLE_MARKUP_EXECUTED__?: boolean })
          .__RIFFLE_MARKUP_EXECUTED__),
    ).toBeUndefined();
  });
}

test("unsafe navigation and resource encodings remain inert", async ({ page }) => {
  const requested: string[] = [];
  page.on("request", (request) => requested.push(request.url()));
  await replaceNote(
    page,
    [
      "[Encoded protocol](%6aavascript:window.riffle)",
      "",
      '<a href="&#x6a;avascript:window.riffle">Entity protocol</a>',
      "",
      "![Remote](https://tracker.invalid/pixel.png)",
      "",
      "![Data](data:image/png;base64,AAAA)",
      "",
      "![Traversal](.markd/assets/%252e%252e/outside.png)",
      "",
      "![SVG](.markd/assets/payload.svg)",
    ].join("\n"),
  );

  const view = page.locator('[data-readonly-markdown="true"]');
  for (const label of ["Encoded protocol", "Entity protocol"]) {
    const link = view.getByText(label, { exact: true });
    await expect(link).toHaveAttribute("data-link-status", "rejected");
    await expect(link).not.toHaveAttribute("href", /.+/);
  }
  for (const label of ["Remote", "Data", "Traversal", "SVG"]) {
    await expect(view.getByRole("img", { name: label })).not.toHaveAttribute(
      "src",
      /.+/,
    );
  }
  expect(requested.some((url) => url.includes("tracker.invalid"))).toBe(false);
});

test("Readonly View keeps code copy and task controls read-only", async ({
  page,
}) => {
  await replaceNote(
    page,
    [
      "- [x] shipped",
      "- [ ] queued",
      "",
      "```ts",
      "const 方向 = 'north 🧭';",
      "```",
    ].join("\n"),
  );

  const tasks = page.locator('[data-readonly-markdown="true"] input[type="checkbox"]');
  await expect(tasks).toHaveCount(2);
  await expect(tasks.nth(0)).toBeChecked();
  await expect(tasks.nth(0)).toBeDisabled();
  await expect(tasks.nth(1)).not.toBeChecked();
  await expect(tasks.nth(1)).toBeDisabled();

  await page.getByRole("button", { name: "Copy code" }).click();
  await expect.poll(() => clipboardText(page)).toBe("const 方向 = 'north 🧭';");
  await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();

  await replaceNote(
    page,
    "- [ ] shipped\n- [x] queued\n\n```ts\nconst 方向 = 'north 🧭';\n```",
  );
  await expect(tasks.nth(0)).not.toBeChecked();
  await expect(tasks.nth(1)).toBeChecked();
});

test("Readonly find highlights and cycles without exposing replace", async ({
  page,
}) => {
  await replaceNote(
    page,
    "# Searchable\n\nAlpha **beta alpha** gamma.\n\nLast ALPHA.",
  );
  await page.locator('[data-readonly-markdown="true"]').click();
  await page.keyboard.press("ControlOrMeta+f");

  const find = page.getByRole("searchbox", { name: "Find in readonly note" });
  await expect(find).toBeFocused();
  await find.fill("alpha");
  await expect(page.getByText("1 of 3", { exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Replace with" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /replace/i })).toHaveCount(0);
  await expect.poll(() => readonlyHighlightCounts(page)).toEqual({
    active: 1,
    all: 3,
  });

  await page.keyboard.press("Enter");
  await expect(page.getByText("2 of 3", { exact: true })).toBeVisible();
  await page.keyboard.press("Shift+Enter");
  await expect(page.getByText("1 of 3", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Previous match" }).click();
  await expect(page.getByText("3 of 3", { exact: true })).toBeVisible();

  await page.getByRole("treeitem", { name: "Projects", exact: true }).click();
  await page.getByRole("treeitem", { name: "Alpha.md", exact: true }).click();
  await expect.poll(() => readonlyHighlightCounts(page)).toEqual({
    active: 0,
    all: 0,
  });
  await page.getByRole("tab", { name: /README/ }).click();
  await expect(find).toBeVisible();
  await expect.poll(() => readonlyHighlightCounts(page)).toEqual({
    active: 1,
    all: 3,
  });

  await page.getByRole("button", { name: "Show Markdown source" }).click();
  await page.locator('[data-note-editor="active"] .cm-content').click();
  await page.keyboard.press("ControlOrMeta+f");
  const sourceFind = page.getByRole("searchbox", { name: "Find in note" });
  await expect(sourceFind).toBeFocused();
  await sourceFind.fill("alpha");
  await expect(page.getByRole("button", { name: "Show replace" })).toBeVisible();
});

async function replaceNote(page: import("@playwright/test").Page, source: string, rel = "README.md") {
  await page.evaluate(({ nextSource, targetRel }) => {
    const fixture = (
      window as Window & {
        __RIFFLE_TEST__: { notes: Map<string, string> };
      }
    ).__RIFFLE_TEST__;
    fixture.notes.set(targetRel, nextSource);
    window.dispatchEvent(new Event("focus"));
  }, { nextSource: source, targetRel: rel });
}

async function openedExternalUrls(page: import("@playwright/test").Page) {
  return page.evaluate(() => (
    window as Window & {
      __RIFFLE_TEST__: { openedExternalUrls: string[] };
    }
  ).__RIFFLE_TEST__.openedExternalUrls);
}

async function clipboardText(page: import("@playwright/test").Page) {
  return page.evaluate(() => (
    window as Window & {
      __RIFFLE_TEST__: { clipboard: string[] };
    }
  ).__RIFFLE_TEST__.clipboard.at(-1));
}

async function noteSource(page: import("@playwright/test").Page, rel: string) {
  return page.evaluate((targetRel) => (
    window as Window & {
      __RIFFLE_TEST__: { notes: Map<string, string> };
    }
  ).__RIFFLE_TEST__.notes.get(targetRel), rel);
}

async function readonlyHighlightCounts(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const highlights = (
      CSS as typeof CSS & {
        highlights: Map<string, { size: number }>;
      }
    ).highlights;
    return {
      all: highlights.get("riffle-readonly-find")?.size ?? 0,
      active: highlights.get("riffle-readonly-find-active")?.size ?? 0,
    };
  });
}
