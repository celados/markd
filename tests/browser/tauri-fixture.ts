import type { Page } from "@playwright/test";

type TauriFixtureOptions = {
  cloudLifecycle?: boolean;
  cloudSignOutFailure?: boolean;
  pinnedFolder?: boolean;
  stalePin?: string;
  taggedTodos?: boolean;
};

export async function installTauriFixture(page: Page, options: TauriFixtureOptions = {}) {
  await page.addInitScript((fixtureOptions) => {
    let nextCallbackId = 1;
    const callbacks = new Map<number, { callback: (data: unknown) => void; once: boolean }>();
    let tree = [
      {
        name: "README.md",
        rel: "README.md",
        kind: "note",
        modifiedMs: 1,
      },
      {
        name: "Projects",
        rel: "Projects",
        kind: "folder",
        modifiedMs: 2,
        children: [
          {
            name: "Alpha.md",
            rel: "Projects/Alpha.md",
            kind: "note",
            modifiedMs: 3,
          },
        ],
      },
      {
        name: "Archive",
        rel: "Archive",
        kind: "folder",
        modifiedMs: 4,
        children: [],
      },
    ];
    let todos = fixtureOptions.taggedTodos
      ? [
          {
            id: "todo-1",
            text: "Ship Octane port",
            done: false,
            createdAt: 2,
            completedAt: null,
            tags: ["work"],
          },
          {
            id: "todo-2",
            text: "Review visual polish",
            done: false,
            createdAt: 1,
            completedAt: null,
            tags: ["later"],
          },
        ]
      : [];
    let todoTags = fixtureOptions.taggedTodos ? ["work", "later"] : [];
    let bookmarks: import("@/lib/types").Bookmark[] = [];
    let bookmarkTags: string[] = [];
    let pins = fixtureOptions.pinnedFolder ? ["Projects"] : [];
    let stalePins = fixtureOptions.stalePin ? [fixtureOptions.stalePin] : [];
    const clipboard: string[] = [];
    let cloudAccount = null as { email: string; plan: "free" | "cloud" } | null;
    let publishedShare = null as null | {
      id: string;
      entryId: string;
      slug: string;
      url: string;
      title: string;
      contentHash: string;
      publishedAt: number;
      updatedAt: number;
      pageCount: number;
      assetCount: number;
    };
    const openedExternalUrls: string[] = [];
    const notes = new Map([
      ["README.md", "---\nfixture: preserved\n---\n# README\n\nOctane + pnpm verification."],
      ["Projects/Alpha.md", "# Alpha\n\nSecond live editor."],
    ]);
    const commands: Array<{ command: string; args: Record<string, unknown> }> = [];
    const success = <T>(value: T) => ({ ok: true as const, value });
    const snapshot = () => ({
      root: "/private/tmp/markd-browser-fixture",
      name: "Fixture Vault",
      tree,
      theme: "system" as const,
    });

    // The renderer journey uses the same semantic Vault boundary as Electron.
    // Legacy Tauri calls remain only for slices that have not migrated yet.
    window.markd = {
      app: {
        windowKind: "main",
        onNotesChanged: () => () => {},
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
        startup: async () => success(snapshot()),
        choose: async () => success(snapshot()),
        create: async () => success(snapshot()),
        snapshot: async () => success(snapshot()),
        createNote: async (dir, title, content = "") => {
          const base = dir ? `${dir}/` : "";
          const rel = `${base}${title}.md`;
          notes.set(rel, content);
          tree = [...tree, { name: `${title}.md`, rel, kind: "note", modifiedMs: Date.now() }];
          return success({ rel, snapshot: snapshot() });
        },
        readNote: async (rel) => success(notes.get(rel) ?? ""),
        writeNote: async (rel, content) => {
          commands.push({ command: "write_note", args: { rel, content } });
          notes.set(rel, content);
          return success(content);
        },
        moveToTrash: async (rel) => {
          notes.delete(rel);
          tree = tree.filter((node) => node.rel !== rel);
          return success({ snapshot: snapshot() });
        },
        resolveNotePath: async (rel) => success(`/private/tmp/markd-browser-fixture/${rel}`),
        pins: {
          list: async () => success({ pins, stale: stalePins }),
          add: async (rel) => {
            stalePins = stalePins.filter((pin) => pin !== rel);
            pins = Array.from(new Set([rel, ...pins]));
            return success({ pins, stale: stalePins });
          },
          remove: async (rel) => {
            pins = pins.filter((pin) => pin !== rel);
            stalePins = stalePins.filter((pin) => pin !== rel);
            return success({ pins, stale: stalePins });
          },
        },
      },
      collections: {
        snapshot: async () => success({ todos, todoTags, bookmarks, bookmarkTags }),
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
            todos = [item, ...todos];
            todoTags = [...new Set([...todoTags, ...tags])];
            return success({ snapshot: { todos, todoTags, bookmarks, bookmarkTags }, item });
          },
          change: async (id, change) => {
            let item = todos.find((todo) => todo.id === id)!;
            if (change.type === "toggle")
              item = { ...item, done: !item.done, completedAt: item.done ? null : Date.now() };
            if (change.type === "text") item = { ...item, text: change.text };
            if (change.type === "tags") {
              item = { ...item, tags: change.tags };
              todoTags = [...new Set([...todoTags, ...change.tags])];
            }
            todos = todos.map((todo) => (todo.id === id ? item : todo));
            return success({ snapshot: { todos, todoTags, bookmarks, bookmarkTags }, item });
          },
          remove: async (id) => {
            todos = todos.filter((todo) => todo.id !== id);
            return success({ todos, todoTags, bookmarks, bookmarkTags });
          },
          clearCompleted: async () => {
            todos = todos.filter((todo) => !todo.done);
            return success({ todos, todoTags, bookmarks, bookmarkTags });
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
            bookmarks = [item, ...bookmarks];
            bookmarkTags = [...new Set([...bookmarkTags, ...tags])];
            return success({ snapshot: { todos, todoTags, bookmarks, bookmarkTags }, item });
          },
          change: async (id, change) => {
            let item = bookmarks.find((bookmark) => bookmark.id === id)!;
            if (change.type === "title") item = { ...item, title: change.title };
            if (change.type === "tags") {
              item = { ...item, tags: change.tags };
              bookmarkTags = [...new Set([...bookmarkTags, ...change.tags])];
            }
            if (change.type === "metadata")
              item = {
                ...item,
                title: change.title ?? item.title,
                image: change.image ?? item.image,
                favicon: change.favicon ?? item.favicon,
                metaFetched: change.fetched,
              };
            bookmarks = bookmarks.map((bookmark) => (bookmark.id === id ? item : bookmark));
            return success({ snapshot: { todos, todoTags, bookmarks, bookmarkTags }, item });
          },
          remove: async (id) => {
            bookmarks = bookmarks.filter((bookmark) => bookmark.id !== id);
            return success({ todos, todoTags, bookmarks, bookmarkTags });
          },
        },
        tags: {
          create: async (collection, name) => {
            if (collection === "todos") todoTags = [...new Set([...todoTags, name])];
            else bookmarkTags = [...new Set([...bookmarkTags, name])];
            return success({ todos, todoTags, bookmarks, bookmarkTags });
          },
          delete: async (collection, name) => {
            if (collection === "todos") {
              todoTags = todoTags.filter((tag) => tag !== name);
              todos = todos.map((item) => ({
                ...item,
                tags: item.tags.filter((tag) => tag !== name),
              }));
            } else {
              bookmarkTags = bookmarkTags.filter((tag) => tag !== name);
              bookmarks = bookmarks.map((item) => ({
                ...item,
                tags: item.tags.filter((tag) => tag !== name),
              }));
            }
            return success({ todos, todoTags, bookmarks, bookmarkTags });
          },
        },
      },
      cloud: {
        accountStatus: async () => success({ account: cloudAccount }),
        requestOtp: async (email) => success({ challengeId: "challenge", email, expiresIn: 600, resendAfter: 30 }),
        verifyOtp: async () => {
          cloudAccount = { email: "reader@example.test", plan: "cloud" as const };
          return success(cloudAccount);
        },
        signOut: async () => {
          cloudAccount = null;
          if (fixtureOptions.cloudSignOutFailure) {
            return {
              ok: false as const,
              error: {
                kind: "cloud",
                message: "Remote sign-out failed.",
                details: { localSignedOut: true },
              },
            };
          }
          return success(null);
        },
        plansUrl: async () => success("https://example.test/plans"),
        billingPortalUrl: async () => success("https://example.test/billing"),
        publishedNoteStatus: async () => success({ account: cloudAccount, share: publishedShare, isOutdated: false }),
        isNotePublished: async () => success(Boolean(publishedShare)),
        publishNote: async (_rel, title) => {
          if (!fixtureOptions.cloudLifecycle) {
            return { ok: false as const, error: { kind: "not_available", message: "Not available in this fixture." } };
          }
          publishedShare = {
            id: "site_123",
            entryId: "entry_123",
            slug: "published-note",
            url: "https://example.test/s/published-note",
            title,
            contentHash: "hash-1",
            publishedAt: 1,
            updatedAt: 1,
            pageCount: 1,
            assetCount: 0,
          };
          return success(publishedShare);
        },
        updatePublishedNote: async (_rel, title) => {
          if (!publishedShare) {
            return { ok: false as const, error: { kind: "not_found", message: "Published Share not found." } };
          }
          publishedShare = { ...publishedShare, title, contentHash: "hash-2", updatedAt: 2 };
          return success(publishedShare);
        },
        revokePublishedNote: async () => {
          publishedShare = null;
          return success(null);
        },
        openExternal: async (url) => {
          openedExternalUrls.push(url);
          return success(null);
        },
      },
      updates: {
        check: async () => success(null),
        install: async () => success(null),
        relaunch: async () => success(null),
      },
    };

    // Browser journeys exercise the public UI seam; this bridge only replaces
    // the Tauri transport that is unavailable in system Chrome.
    window.__TAURI_INTERNALS__ = {
      metadata: {
        currentWindow: { label: "main" },
        currentWebview: { windowLabel: "main", label: "main" },
      },
      transformCallback(callback: (data: unknown) => void, once = false) {
        const id = nextCallbackId++;
        callbacks.set(id, { callback, once });
        return id;
      },
      unregisterCallback(id: number) {
        callbacks.delete(id);
      },
      runCallback(id: number, data: unknown) {
        const entry = callbacks.get(id);
        if (!entry) return;
        entry.callback(data);
        if (entry.once) callbacks.delete(id);
      },
      callbacks,
      convertFileSrc(path: string, protocol = "asset") {
        return `${protocol}://localhost/${encodeURIComponent(path)}`;
      },
      async invoke(command: string, args: Record<string, unknown> = {}) {
        commands.push({ command, args });
        switch (command) {
          case "startup":
            return {
              root: "/tmp/markd-browser-fixture",
              name: "Fixture Vault",
              tree,
              theme: "system",
            };
          case "load_tree":
            return tree;
          case "read_note":
            return notes.get(String(args.rel)) ?? "";
          case "write_note":
            notes.set(String(args.rel), String(args.content));
            return null;
          case "search_notes":
            return [
              {
                rel: "Projects/Alpha.md",
                title: "Alpha result",
                snippet: "first result",
                titleMatch: true,
              },
              {
                rel: "README.md",
                title: "README result",
                snippet: "second result",
                titleMatch: false,
              },
            ];
          case "backlinks_for":
          case "bookmarks_list":
          case "bookmark_tags_list":
            return [];
          case "pins_list":
            return pins;
          case "pin_note":
            pins = Array.from(new Set([...pins, String(args.rel)]));
            return pins;
          case "unpin_note":
            pins = pins.filter((rel) => rel !== String(args.rel));
            return pins;
          case "note_path":
            return `/private/tmp/markd-browser-fixture/${String(args.rel)}`;
          case "todos_list":
            return todos;
          case "todo_tags_list":
            return todoTags;
          case "todo_set_tags": {
            const id = String(args.id);
            const tags = Array.isArray(args.tags) ? args.tags.map((tag) => String(tag)) : [];
            todos = todos.map((todo) => (todo.id === id ? { ...todo, tags } : todo));
            return todos.find((todo) => todo.id === id);
          }
          case "todo_tag_delete": {
            const name = String(args.name);
            todoTags = todoTags.filter((tag) => tag !== name);
            todos = todos.map((todo) => ({
              ...todo,
              tags: todo.tags.filter((tag) => tag !== name),
            }));
            return todoTags;
          }
          case "is_note_published":
            return false;
          case "cloud_account_status":
            return { account: null };
          case "plugin:event|listen":
            return args.handler ?? 1;
          case "plugin:event|unlisten":
          case "plugin:updater|check":
          case "move_entry":
            return null;
          default:
            return null;
        }
      },
    };
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
      unregisterListener(_event: string, id: number) {
        callbacks.delete(id);
      },
    };
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          clipboard.push(value);
        },
      },
    });
    Object.assign(window, {
      __MARKD_TEST__: { clipboard, commands, notes, openedExternalUrls },
    });
  }, options);
}
