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
  await expect(error).toContainText("Unsupported Markdown node: unsupported");
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
