import type { Page } from "@playwright/test";

export async function installMarkdFixture(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const success = <T>(value: T) => ({ ok: true as const, value });
    const fixtureAssetUrl = (rel: string) =>
      rel.startsWith(".markd/assets/") && !rel.slice(".markd/assets/".length).includes("/")
        ? `markd-asset://vault/${rel.slice(".markd/assets/".length)}`
        : null;
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
        export: async () => success("/tmp/bookmarks.md"),
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
        onEngineLifecycle: () => () => {},
      },
      capture: {
        open: async () => success(null),
        close: async () => success(null),
        create: async (title, content) => success({
          rel: `${title}.md`,
          snapshot: {
            root: "/tmp/markd-fixture",
            name: "Fixture Vault",
            tree: [],
            theme: "system" as const,
          },
        }),
        append: async (rel) => success({
          rel,
          snapshot: {
            root: "/tmp/markd-fixture",
            name: "Fixture Vault",
            tree: [],
            theme: "system" as const,
          },
        }),
        onOpen: () => () => {},
      },
      vault: {
        onIndexEvent: () => () => {},
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
        writeNote: async (_rel, content) => success(content),
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
        exportNote: async (rel) => success(`/tmp/${rel.split("/").at(-1)}`),
        assets: {
          save: async () => success(".markd/assets/fixture.png"),
          url: fixtureAssetUrl,
        },
        pins: {
          list: async () => success({ pins: [], stale: [] }),
          add: async (rel) => success({ pins: [rel], stale: [] }),
          remove: async () => success({ pins: [], stale: [] }),
        },
      },
      collections,
      cloud: {
        accountStatus: async () => success({ account: null }),
        requestOtp: async (email) => success({ challengeId: "challenge", email, expiresIn: 600, resendAfter: 30 }),
        verifyOtp: async () => success({ email: "reader@example.test", plan: "free" as const }),
        signOut: async () => success(null),
        plansUrl: async () => success("https://example.test/plans"),
        billingPortalUrl: async () => success("https://example.test/billing"),
        publishedNoteStatus: async () => success({ account: null, share: null, isOutdated: false }),
        isNotePublished: async () => success(false),
        publishNote: async () => ({ ok: false as const, error: { kind: "not_available", message: "Not available in this fixture." } }),
        updatePublishedNote: async () => ({ ok: false as const, error: { kind: "not_available", message: "Not available in this fixture." } }),
        revokePublishedNote: async () => success(null),
        openExternal: async () => success(null),
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
    const fixtureAssetUrl = (rel: string) =>
      rel.startsWith(".markd/assets/") && !rel.slice(".markd/assets/".length).includes("/")
        ? `markd-asset://vault/${rel.slice(".markd/assets/".length)}`
        : null;
    const trashCalls: string[] = [];
    const operations: string[] = [];
    const failWrites = { value: false };
    const deferWrites = { value: false };
    const deferredWrites: Array<{
      content: string;
      resolve: (result: { ok: true; value: string } | {
        ok: false;
        error: { kind: string; message: string };
      }) => void;
    }> = [];
    const indexListeners = new Set<(
      event: import("@/lib/desktop").VaultIndexEvent,
    ) => void>();
    const collections = window.markd!.collections;

    window.markd = {
      app: {
        windowKind: "main",
        onEngineLifecycle: () => () => {},
      },
      capture: {
        open: async () => success(null),
        close: async () => success(null),
        create: async (title, content) => {
          const rel = `${title}.md`;
          notes.set(rel, content);
          return success({ rel, snapshot: snapshot() });
        },
        append: async (rel, content) => {
          notes.set(rel, `${notes.get(rel) ?? ""}\n${content}`);
          return success({ rel, snapshot: snapshot() });
        },
        onOpen: () => () => {},
      },
      vault: {
        onIndexEvent: (listener) => {
          indexListeners.add(listener);
          return () => indexListeners.delete(listener);
        },
        startup: async () => success(snapshot()),
        choose: async () => {
          operations.push("choose");
          return success(snapshot());
        },
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
          operations.push(`write:${rel}`);
          if (deferWrites.value) {
            return new Promise((resolve) => deferredWrites.push({ content, resolve }));
          }
          if (failWrites.value) {
            return {
              ok: false as const,
              error: { kind: "STALE_NOTE_WRITE", message: "fixture conflict" },
            };
          }
          notes.set(rel, content);
          return success(content);
        },
        moveToTrash: async (rel) => {
          trashCalls.push(rel);
          await new Promise((resolve) => setTimeout(resolve, 25));
          tree = tree.filter((node) => node.rel !== rel);
          notes.delete(rel);
          return success({ snapshot: snapshot() });
        },
        resolveNotePath: async (rel) => success(`${root}/${rel}`),
        exportNote: async (rel) => success(`/tmp/${rel.split("/").at(-1)}`),
        assets: {
          save: async () => success(".markd/assets/fixture.png"),
          url: fixtureAssetUrl,
        },
        pins: {
          list: async () => success({ pins: [], stale: [] }),
          add: async (rel) => success({ pins: [rel], stale: [] }),
          remove: async () => success({ pins: [], stale: [] }),
        },
      },
      collections,
      cloud: {
        accountStatus: async () => success({ account: null }),
        requestOtp: async (email) => success({ challengeId: "challenge", email, expiresIn: 600, resendAfter: 30 }),
        verifyOtp: async () => success({ email: "reader@example.test", plan: "free" as const }),
        signOut: async () => success(null),
        plansUrl: async () => success("https://example.test/plans"),
        billingPortalUrl: async () => success("https://example.test/billing"),
        publishedNoteStatus: async () => success({ account: null, share: null, isOutdated: false }),
        isNotePublished: async () => success(false),
        publishNote: async () => ({ ok: false as const, error: { kind: "not_available", message: "Not available in this fixture." } }),
        updatePublishedNote: async () => ({ ok: false as const, error: { kind: "not_available", message: "Not available in this fixture." } }),
        revokePublishedNote: async () => success(null),
        openExternal: async () => success(null),
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
    Object.assign(window, {
      __MARKD_VAULT_TEST__: {
        trashCalls,
        notes,
        operations,
        failWrites,
        deferWrites,
        failNextDeferredWrite: () => deferredWrites.shift()?.resolve({
          ok: false,
          error: { kind: "STALE_NOTE_WRITE", message: "deferred fixture conflict" },
        }),
        succeedNextDeferredWrite: () => {
          const write = deferredWrites.shift();
          write?.resolve(success(write.content));
        },
        emitIndexEvent: (event: import("@/lib/desktop").VaultIndexEvent) => {
          for (const listener of indexListeners) listener(event);
        },
      },
    });
  });
}
