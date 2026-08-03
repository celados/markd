import type { Page } from "@playwright/test";

export async function installMarkdFixture(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const success = <T>(value: T) => ({ ok: true as const, value });
    let collectionsSnapshot = {
      todos: [] as import("@/lib/types").Todo[],
      todoTags: [] as string[],
      bookmarks: [] as import("@/lib/types").Bookmark[],
      bookmarkTags: [] as string[],
    };
    const collections: import("@/lib/desktop").MarkdDesktop["collections"] = {
      snapshot: async () => success(collectionsSnapshot),
      todos: {
        create: async (text, tags = []) => {
          const item = {
            id: crypto.randomUUID(),
            text: text.trim(),
            done: false,
            createdAt: Date.now(),
            completedAt: null,
            tags,
          };
          collectionsSnapshot = {
            ...collectionsSnapshot,
            todos: [item, ...collectionsSnapshot.todos],
            todoTags: [...new Set([...collectionsSnapshot.todoTags, ...tags])],
          };
          return success({ snapshot: collectionsSnapshot, item });
        },
        change: async (id, change) => {
          let item = collectionsSnapshot.todos.find((todo) => todo.id === id)!;
          if (change.type === "toggle")
            item = { ...item, done: !item.done, completedAt: item.done ? null : Date.now() };
          if (change.type === "text") item = { ...item, text: change.text };
          if (change.type === "tags") item = { ...item, tags: change.tags };
          collectionsSnapshot = {
            ...collectionsSnapshot,
            todos: collectionsSnapshot.todos.map((todo) => (todo.id === id ? item : todo)),
          };
          return success({ snapshot: collectionsSnapshot, item });
        },
        remove: async (id) => {
          collectionsSnapshot = {
            ...collectionsSnapshot,
            todos: collectionsSnapshot.todos.filter((todo) => todo.id !== id),
          };
          return success(collectionsSnapshot);
        },
        clearCompleted: async () => {
          collectionsSnapshot = {
            ...collectionsSnapshot,
            todos: collectionsSnapshot.todos.filter((todo) => !todo.done),
          };
          return success(collectionsSnapshot);
        },
      },
      bookmarks: {
        create: async (url, tags = []) => {
          const normalized = url.startsWith("http") ? url : `https://${url}`;
          const item = {
            id: crypto.randomUUID(),
            url: normalized,
            title: normalized.replace(/^https?:\/\//, ""),
            image: null,
            favicon: null,
            metaFetched: false,
            tags,
            createdAt: Date.now(),
          };
          collectionsSnapshot = {
            ...collectionsSnapshot,
            bookmarks: [item, ...collectionsSnapshot.bookmarks],
            bookmarkTags: [...new Set([...collectionsSnapshot.bookmarkTags, ...tags])],
          };
          return success({ snapshot: collectionsSnapshot, item });
        },
        change: async (id, change) => {
          let item = collectionsSnapshot.bookmarks.find((bookmark) => bookmark.id === id)!;
          if (change.type === "title") item = { ...item, title: change.title };
          if (change.type === "tags") item = { ...item, tags: change.tags };
          if (change.type === "metadata")
            item = {
              ...item,
              title: change.title ?? item.title,
              image: change.image ?? item.image,
              favicon: change.favicon ?? item.favicon,
              metaFetched: change.fetched,
            };
          collectionsSnapshot = {
            ...collectionsSnapshot,
            bookmarks: collectionsSnapshot.bookmarks.map((bookmark) =>
              bookmark.id === id ? item : bookmark,
            ),
          };
          return success({ snapshot: collectionsSnapshot, item });
        },
        remove: async (id) => {
          collectionsSnapshot = {
            ...collectionsSnapshot,
            bookmarks: collectionsSnapshot.bookmarks.filter((bookmark) => bookmark.id !== id),
          };
          return success(collectionsSnapshot);
        },
      },
      tags: {
        create: async (collection, name) => {
          if (collection === "todos")
            collectionsSnapshot = {
              ...collectionsSnapshot,
              todoTags: [...new Set([...collectionsSnapshot.todoTags, name])],
            };
          else
            collectionsSnapshot = {
              ...collectionsSnapshot,
              bookmarkTags: [...new Set([...collectionsSnapshot.bookmarkTags, name])],
            };
          return success(collectionsSnapshot);
        },
        delete: async (collection, name) => {
          if (collection === "todos")
            collectionsSnapshot = {
              ...collectionsSnapshot,
              todoTags: collectionsSnapshot.todoTags.filter((tag) => tag !== name),
              todos: collectionsSnapshot.todos.map((item) => ({
                ...item,
                tags: item.tags.filter((tag) => tag !== name),
              })),
            };
          else
            collectionsSnapshot = {
              ...collectionsSnapshot,
              bookmarkTags: collectionsSnapshot.bookmarkTags.filter((tag) => tag !== name),
              bookmarks: collectionsSnapshot.bookmarks.map((item) => ({
                ...item,
                tags: item.tags.filter((tag) => tag !== name),
              })),
            };
          return success(collectionsSnapshot);
        },
      },
    };
    window.markd = {
      app: {
        windowKind: "main",
        onNotesChanged: () => () => {},
        onEngineLifecycle: () => () => {},
      },
      vault: {
        startup: async () => success(null),
        choose: async () => success(null),
        create: async () => success(null),
        snapshot: async () =>
          success({
            root: "/tmp/markd-fixture",
            name: "Fixture Vault",
            tree: [],
            theme: "system" as const,
          }),
        createNote: async () =>
          success({
            rel: "Untitled.md",
            snapshot: {
              root: "/tmp/markd-fixture",
              name: "Fixture Vault",
              tree: [],
              theme: "system" as const,
            },
          }),
        readNote: async () => success(""),
        writeNote: async () => success(null),
        moveToTrash: async () =>
          success({
            snapshot: {
              root: "/tmp/markd-fixture",
              name: "Fixture Vault",
              tree: [],
              theme: "system" as const,
            },
          }),
        resolveNotePath: async (rel) => success(`/tmp/markd-fixture/${rel}`),
        pins: {
          list: async () => success({ pins: [], stale: [] }),
          add: async (rel) => success({ pins: [rel], stale: [] }),
          remove: async () => success({ pins: [], stale: [] }),
        },
      },
      collections,
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
  await installMarkdFixture(page);
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
    const collections = window.markd!.collections;

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
        resolveNotePath: async (rel) => success(`${root}/${rel}`),
        pins: {
          list: async () => success({ pins: [], stale: [] }),
          add: async (rel) => success({ pins: [rel], stale: [] }),
          remove: async () => success({ pins: [], stale: [] }),
        },
      },
      collections,
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
