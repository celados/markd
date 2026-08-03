import type { Page } from "@playwright/test";

export async function installMarkdFixture(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const success = <T>(value: T) => ({ ok: true as const, value });
    window.markd = {
      app: {
        windowKind: "main",
        onNotesChanged: () => () => {},
        onEngineLifecycle: () => () => {},
      },
      vault: {
        startup: async () => success(null),
      },
      cloud: {
        accountStatus: async () => success({ account: null }),
        plansUrl: async () => success("https://example.test/plans"),
        billingPortalUrl: async () => success("https://example.test/billing"),
      },
      updates: {
        check: async () => success(null),
        install: async () => success(null),
        relaunch: async () => success(null),
      },
    };
  });
}

export async function installVaultSliceFixture(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const root = "/tmp/markd-semantic-vault";
    let tree = [
      {
        name: "Existing.md",
        rel: "Existing.md",
        kind: "note" as const,
        modifiedMs: 1,
      },
    ];
    const notes = new Map<string, string>([["Existing.md", "# Existing"]]);
    const snapshot = () => ({
      root,
      name: "Semantic Vault",
      tree,
      theme: "system" as const,
    });
    const success = <T>(value: T) => ({ ok: true as const, value });
    const trashCalls: string[] = [];

    window.markd = {
      app: {
        windowKind: "main",
        onNotesChanged: () => () => {},
        onEngineLifecycle: () => () => {},
      },
      vault: {
        startup: async () => success(snapshot()),
        choose: async () => success(snapshot()),
        create: async () => success(snapshot()),
        snapshot: async () => success(snapshot()),
        createNote: async (_dir, title, content = "") => {
          const rel = `${title}.md`;
          notes.set(rel, content);
          tree = [...tree, { name: rel, rel, kind: "note", modifiedMs: 2 }];
          return success({ rel, snapshot: snapshot() });
        },
        readNote: async (rel) => success(notes.get(rel) ?? ""),
        writeNote: async (rel, content) => {
          notes.set(rel, content);
          return success(null);
        },
        moveToTrash: async (rel) => {
          trashCalls.push(rel);
          await new Promise((resolve) => setTimeout(resolve, 25));
          tree = tree.filter((node) => node.rel !== rel);
          notes.delete(rel);
          return success({ snapshot: snapshot() });
        },
      },
      cloud: {
        accountStatus: async () => success({ account: null }),
        plansUrl: async () => success("https://example.test/plans"),
        billingPortalUrl: async () => success("https://example.test/billing"),
      },
      updates: {
        check: async () => success(null),
        install: async () => success(null),
        relaunch: async () => success(null),
      },
    };
    window.__TAURI_INTERNALS__ = {
      metadata: {
        currentWindow: { label: "main" },
        currentWebview: { windowLabel: "main", label: "main" },
      },
      transformCallback: () => 1,
      unregisterCallback: () => {},
      runCallback: () => {},
      callbacks: new Map(),
      convertFileSrc: (path: string) => path,
      invoke: async (command: string) => {
        if (command === "pins_list" || command === "bookmarks_list") return [];
        return null;
      },
    };
    Object.assign(window, { __MARKD_VAULT_TEST__: { trashCalls } });
  });
}
