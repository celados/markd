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

test("Electron asset URLs are supplied only by the semantic bridge", async ({ page }) => {
  await installVaultSliceFixture(page);
  await page.goto("/");
  await page.evaluate(() => {
    const fixture = (
      window as Window & {
        __MARKD_VAULT_TEST__: { notes: Map<string, string> };
      }
    ).__MARKD_VAULT_TEST__;
    fixture.notes.set(
      "Existing.md",
      "![safe](.markd/assets/fixture.png)\n\n![escape](../outside.png)",
    );
  });
  await page.getByRole("treeitem", { name: "Existing.md" }).click();

  await expect(page.locator('img[data-vault-src=".markd/assets/fixture.png"]')).toHaveAttribute(
    "src",
    "markd-asset://vault/fixture.png",
  );
  await expect(page.locator('img[data-vault-src="../outside.png"]')).toHaveAttribute("src", "");
});

test("live index changes reload clean Notes and preserve dirty drafts", async ({ page }) => {
  await installVaultSliceFixture(page);
  await page.goto("/");
  await page.getByRole("treeitem", { name: "Existing.md" }).click();
  const editor = page.locator('[data-note-editor="active"] .ProseMirror');

  await page.evaluate(() => {
    const fixture = (window as Window & {
      __MARKD_VAULT_TEST__: {
        notes: Map<string, string>;
        emitIndexEvent: (event: import("@/lib/desktop").VaultIndexEvent) => void;
      };
    }).__MARKD_VAULT_TEST__;
    fixture.notes.set("Existing.md", "# Clean external edit");
    fixture.emitIndexEvent({
      kind: "changes",
      indexEpoch: 1,
      sequence: 1,
      changes: [{
        kind: "modified",
        entry: { rel: "Existing.md", kind: "note", modifiedMs: 2 },
      }],
    });
  });
  await expect(editor).toContainText("Clean external edit");

  await editor.click();
  await page.keyboard.press("End");
  await page.keyboard.type(" local draft");
  await page.evaluate(() => {
    const fixture = (window as Window & {
      __MARKD_VAULT_TEST__: {
        notes: Map<string, string>;
        emitIndexEvent: (event: import("@/lib/desktop").VaultIndexEvent) => void;
      };
    }).__MARKD_VAULT_TEST__;
    fixture.notes.set("Existing.md", "# Conflicting external edit");
    fixture.emitIndexEvent({
      kind: "changes",
      indexEpoch: 1,
      sequence: 2,
      changes: [{
        kind: "modified",
        entry: { rel: "Existing.md", kind: "note", modifiedMs: 3 },
      }],
    });
    fixture.notes.delete("Existing.md");
    fixture.emitIndexEvent({
      kind: "changes",
      indexEpoch: 1,
      sequence: 3,
      changes: [{ kind: "removed", rel: "Existing.md" }],
    });
  });

  await expect(editor).toContainText("local draft");
  await expect(page.getByRole("tab", { name: /Existing/ })).toBeVisible();
  await expect(page.getByRole("treeitem", { name: "Existing.md" })).toHaveCount(0);
});

test("external removal closes a clean Note tab and view", async ({ page }) => {
  await installVaultSliceFixture(page);
  await page.goto("/");
  await page.getByRole("treeitem", { name: "Existing.md" }).click();
  await expect(page.getByRole("tab", { name: /Existing/ })).toBeVisible();

  await page.evaluate(() => {
    const fixture = (window as Window & {
      __MARKD_VAULT_TEST__: {
        notes: Map<string, string>;
        emitIndexEvent: (event: import("@/lib/desktop").VaultIndexEvent) => void;
      };
    }).__MARKD_VAULT_TEST__;
    fixture.notes.delete("Existing.md");
    fixture.emitIndexEvent({
      kind: "changes",
      indexEpoch: 1,
      sequence: 1,
      changes: [{ kind: "removed", rel: "Existing.md" }],
    });
  });

  await expect(page.getByRole("tab", { name: /Existing/ })).toHaveCount(0);
  await expect(page.locator('[data-note-editor="active"]')).toHaveCount(0);
  await expect(page.getByRole("treeitem", { name: "Existing.md" })).toHaveCount(0);
});

test("removal during an in-flight save remains visibly missing", async ({ page }) => {
  await installVaultSliceFixture(page);
  await page.goto("/");
  await page.getByRole("treeitem", { name: "Existing.md" }).click();
  const editor = page.locator('[data-note-editor="active"] .ProseMirror');
  await page.evaluate(() => {
    (window as Window & {
      __MARKD_VAULT_TEST__: { deferWrites: { value: boolean } };
    }).__MARKD_VAULT_TEST__.deferWrites.value = true;
  });
  await editor.click();
  await page.keyboard.press("End");
  await page.keyboard.type(" pending save");
  await expect.poll(() => page.evaluate(() =>
    (window as Window & {
      __MARKD_VAULT_TEST__: { operations: string[] };
    }).__MARKD_VAULT_TEST__.operations,
  )).toEqual(["write:Existing.md"]);

  await page.evaluate(() => {
    const fixture = (window as Window & {
      __MARKD_VAULT_TEST__: {
        notes: Map<string, string>;
        emitIndexEvent: (event: import("@/lib/desktop").VaultIndexEvent) => void;
        succeedNextDeferredWrite: () => void;
      };
    }).__MARKD_VAULT_TEST__;
    fixture.notes.delete("Existing.md");
    fixture.emitIndexEvent({
      kind: "changes",
      indexEpoch: 1,
      sequence: 1,
      changes: [{ kind: "removed", rel: "Existing.md" }],
    });
    fixture.succeedNextDeferredWrite();
  });

  await expect(page.getByText(/This note no longer exists/)).toBeVisible();
  await expect(page.getByText(/local draft is preserved below/)).toBeVisible();
  await expect(editor).toContainText("pending save");
  await expect(page.getByRole("tab", { name: /Existing/ })).toBeVisible();
  await expect(page.getByRole("treeitem", { name: "Existing.md" })).toHaveCount(0);
});

test("Vault switch flushes dirty Notes before sending open", async ({ page }) => {
  await installVaultSliceFixture(page);
  await page.goto("/");
  await page.getByRole("treeitem", { name: "Existing.md" }).click();
  const editor = page.locator('[data-note-editor="active"] .ProseMirror');
  await editor.click();
  await page.keyboard.press("End");
  await page.keyboard.type(" dirty before switch");
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Change" }).click();

  await expect.poll(() => page.evaluate(() =>
    (window as Window & {
      __MARKD_VAULT_TEST__: { operations: string[] };
    }).__MARKD_VAULT_TEST__.operations,
  )).toEqual(["write:Existing.md", "choose"]);
});

test("failed dirty flush prevents Vault switch", async ({ page }) => {
  await installVaultSliceFixture(page);
  await page.goto("/");
  await page.getByRole("treeitem", { name: "Existing.md" }).click();
  const editor = page.locator('[data-note-editor="active"] .ProseMirror');
  await editor.click();
  await page.keyboard.press("End");
  await page.keyboard.type(" conflicting draft");
  await page.evaluate(() => {
    (window as Window & {
      __MARKD_VAULT_TEST__: { failWrites: { value: boolean } };
    }).__MARKD_VAULT_TEST__.failWrites.value = true;
  });
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Change" }).click();

  await expect.poll(() => page.evaluate(() =>
    (window as Window & {
      __MARKD_VAULT_TEST__: { operations: string[] };
    }).__MARKD_VAULT_TEST__.operations,
  )).toEqual(["write:Existing.md"]);
  await page.getByRole("button", { name: "Close settings" }).click();
  await expect(page.getByRole("tab", { name: /Existing/ })).toBeVisible();
  await expect(editor).toContainText("conflicting draft");
});

test("failed queued writes retain the newest draft for a switch retry", async ({ page }) => {
  await installVaultSliceFixture(page);
  await page.goto("/");
  await page.getByRole("treeitem", { name: "Existing.md" }).click();
  const editor = page.locator('[data-note-editor="active"] .ProseMirror');
  await page.evaluate(() => {
    (window as Window & {
      __MARKD_VAULT_TEST__: { deferWrites: { value: boolean } };
    }).__MARKD_VAULT_TEST__.deferWrites.value = true;
  });
  await editor.click();
  await page.keyboard.press("End");
  await page.keyboard.type(" draft one");
  await expect.poll(() => page.evaluate(() =>
    (window as Window & {
      __MARKD_VAULT_TEST__: { operations: string[] };
    }).__MARKD_VAULT_TEST__.operations,
  )).toEqual(["write:Existing.md"]);
  await page.keyboard.type(" draft two");
  await page.waitForTimeout(600);
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Change" }).click();
  await page.evaluate(() => {
    (window as Window & {
      __MARKD_VAULT_TEST__: { failNextDeferredWrite: () => void };
    }).__MARKD_VAULT_TEST__.failNextDeferredWrite();
  });
  await page.getByRole("button", { name: "Close settings" }).click();

  await page.evaluate(() => {
    (window as Window & {
      __MARKD_VAULT_TEST__: { deferWrites: { value: boolean } };
    }).__MARKD_VAULT_TEST__.deferWrites.value = false;
  });
  await editor.click();
  await page.keyboard.press("End");
  await page.keyboard.type(" newest");
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Change" }).click();

  await expect.poll(() => page.evaluate(() =>
    (window as Window & {
      __MARKD_VAULT_TEST__: { operations: string[] };
    }).__MARKD_VAULT_TEST__.operations,
  )).toEqual(["write:Existing.md", "write:Existing.md", "choose"]);
  expect(await page.evaluate(() =>
    (window as Window & {
      __MARKD_VAULT_TEST__: { notes: Map<string, string> };
    }).__MARKD_VAULT_TEST__.notes.get("Existing.md"),
  )).toContain("draft one draft two newest");
});
