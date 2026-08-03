import { expect, test } from "@playwright/test";
import { installMarkdFixture } from "./markd-fixture";

test("Quick Capture creates, appends, and reports Engine failures", async ({ page }) => {
  await installMarkdFixture(page);
  await page.addInitScript(() => {
    const desktop = window.markd!;
    const openListeners = new Set<() => void>();
    const calls: Array<{ method: string; title?: string; rel?: string; content: string }> = [];
    let appendFails = false;
    const success = <T>(value: T) => ({ ok: true as const, value });
    window.markd = {
      ...desktop,
      app: { ...desktop.app, windowKind: "quick-capture" },
      capture: {
        open: async () => {
          for (const listener of openListeners) listener();
          return success(null);
        },
        close: async () => success(null),
        create: async (title, content) => {
          calls.push({ method: "create", title, content });
          return success({
            rel: `${title}.md`,
            snapshot: {
              root: "/tmp/markd-fixture",
              name: "Fixture Vault",
              tree: [],
              theme: "system" as const,
            },
          });
        },
        append: async (rel, content) => {
          calls.push({ method: "append", rel, content });
          if (appendFails) {
            return {
              ok: false as const,
              error: {
                kind: "ENGINE_UNAVAILABLE",
                message: "Markd Engine is unavailable.",
              },
            };
          }
          return success({
            rel,
            snapshot: {
              root: "/tmp/markd-fixture",
              name: "Fixture Vault",
              tree: [],
              theme: "system" as const,
            },
          });
        },
        onOpen: (listener) => {
          openListeners.add(listener);
          return () => openListeners.delete(listener);
        },
      },
    };
    Object.assign(window, {
      __MARKD_CAPTURE_TEST__: {
        calls,
        failAppend: () => {
          appendFails = true;
        },
      },
    });
  });
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Quick capture" })).toBeVisible();
  await page.getByPlaceholder("Title").fill("Inbox");
  await page.getByPlaceholder("Write something worth keeping…").fill("first thought");
  await page.getByRole("button", { name: "Create captured note" }).click();
  await expect(page.getByPlaceholder("Title")).toHaveValue("");
  await page.evaluate(() => window.markd!.capture.open());

  await page.getByRole("button", { name: "Append to note" }).click();
  await page.getByPlaceholder(/Note path/).fill("Inbox.md");
  await page.getByPlaceholder("Write something worth keeping…").fill("second thought");
  await page.getByRole("button", { name: "Append capture" }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as Window & {
          __MARKD_CAPTURE_TEST__?: { calls: unknown[] };
        }).__MARKD_CAPTURE_TEST__?.calls,
      ),
    )
    .toEqual([
      { method: "create", title: "Inbox", content: "first thought" },
      { method: "append", rel: "Inbox.md", content: "second thought" },
    ]);

  await page.evaluate(() => {
    const testState = (window as Window & {
      __MARKD_CAPTURE_TEST__?: { failAppend: () => void };
    }).__MARKD_CAPTURE_TEST__!;
    testState.failAppend();
    void window.markd!.capture.open();
  });
  await page.getByRole("button", { name: "Append to note" }).click();
  await page.getByPlaceholder(/Note path/).fill("Inbox.md");
  await page.getByPlaceholder("Write something worth keeping…").fill("kept draft");
  await page.getByRole("button", { name: "Append capture" }).click();
  await expect(page.getByRole("alert")).toHaveText("Markd Engine is unavailable.");
  await page.evaluate(() => window.markd!.capture.open());
  await expect(page.getByRole("button", { name: "Append to note" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByPlaceholder(/Note path/)).toHaveValue("Inbox.md");
  await expect(page.getByPlaceholder("Write something worth keeping…")).toHaveValue(
    "kept draft",
  );
  await page.getByRole("button", { name: "Close Quick Capture" }).click();
  await page.evaluate(() => window.markd!.capture.open());
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Create new note" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByPlaceholder("Title")).toHaveValue("");
  await expect(page.getByPlaceholder("Write something worth keeping…")).toHaveValue("");
});
