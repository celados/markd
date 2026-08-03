import type { Page } from "@playwright/test";

type DesktopFixtureOptions = {
  cloudLifecycle?: boolean;
  cloudSignOutFailure?: boolean;
  largeTreeSize?: number;
  mutationCollision?: boolean;
  mutationFailure?: boolean;
  pinnedFolder?: boolean;
  stalePin?: string;
  taggedTodos?: boolean;
};

export async function installDesktopFixture(page: Page, options: DesktopFixtureOptions = {}) {
  await page.addInitScript((fixtureOptions) => {
    let tree: import("@/lib/types").TreeNode[] = fixtureOptions.largeTreeSize
      ? Array.from({ length: fixtureOptions.largeTreeSize }, (_, index) => ({
          name: `Note ${String(index).padStart(4, "0")}.md`,
          rel: `Note ${String(index).padStart(4, "0")}.md`,
          kind: "note" as const,
          modifiedMs: index,
        }))
      : [
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
    const operations: Array<{ method: string; params: Record<string, unknown> }> = [];
    const success = <T>(value: T) => ({ ok: true as const, value });
    const snapshot = () => ({
      root: "/private/tmp/markd-browser-fixture",
      name: "Fixture Vault",
      tree,
      theme: "system" as const,
    });

    // Browser journeys replace only the secure preload boundary. Product code
    // still consumes the same semantic desktop surface as packaged Electron.
    window.markd = {
      app: {
        windowKind: "main",
        onEngineLifecycle: () => () => {},
        openWebUrl: async (url) => {
          openedExternalUrls.push(url);
          return success(null);
        },
        revealVaultEntry: async (rel) => {
          operations.push({ method: "external.revealVaultEntry", params: { rel } });
          return success(null);
        },
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
        onIndexEvent: () => () => {},
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
        openDailyNote: async (date) => {
          const rel = `${date}.md`;
          if (!notes.has(rel)) notes.set(rel, `# ${date}\n`);
          return success({ rel, snapshot: snapshot() });
        },
        createFolder: async (dir, name) => {
          operations.push({ method: "vault.entries.createFolder", params: { dir, name } });
          const rel = dir ? `${dir}/${name}` : name;
          tree = insertTreeEntry(tree, dir, {
            name,
            rel,
            kind: "folder",
            modifiedMs: Date.now(),
            children: [],
          });
          return success({ rel, snapshot: snapshot() });
        },
        renameEntry: async (rel, name) => {
          operations.push({ method: "vault.entries.rename", params: { rel, name } });
          if (fixtureOptions.mutationFailure) {
            return { ok: false as const, error: { kind: "IO_ERROR", message: "Rename rejected by disk" } };
          }
          const parent = rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "";
          const persistedName = fixtureOptions.mutationCollision ? withCollisionSuffix(name) : name;
          const next = parent ? `${parent}/${persistedName}` : persistedName;
          tree = remapTree(tree, rel, next);
          return success({ rel: next, snapshot: snapshot() });
        },
        moveEntry: async (rel, dir) => {
          operations.push({ method: "vault.entries.move", params: { rel, dir } });
          if (fixtureOptions.mutationFailure) {
            return { ok: false as const, error: { kind: "IO_ERROR", message: "Move rejected by disk" } };
          }
          const requestedName = rel.slice(rel.lastIndexOf("/") + 1);
          const name = fixtureOptions.mutationCollision ? withCollisionSuffix(requestedName) : requestedName;
          const next = dir ? `${dir}/${name}` : name;
          tree = moveTreeEntry(tree, rel, next);
          return success({ rel: next, snapshot: snapshot() });
        },
        readNote: async (rel) => success(notes.get(rel) ?? ""),
        writeNote: async (rel, content) => {
          operations.push({ method: "vault.notes.write", params: { rel, content } });
          notes.set(rel, content);
          return success(content);
        },
        moveToTrash: async (rel) => {
          notes.delete(rel);
          tree = tree.filter((node) => node.rel !== rel);
          return success({ snapshot: snapshot() });
        },
        resolveNotePath: async (rel) => success(`/private/tmp/markd-browser-fixture/${rel}`),
        getTheme: async () => success("system" as const),
        setTheme: async () => success(null),
        search: async () => success([
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
        ]),
        recordSearchAccess: async (rel) => {
          operations.push({ method: "vault.search.recordAccess", params: { rel } });
          return success(null);
        },
        backlinks: async () => success([]),
        assets: {
          save: async () => success(".markd/assets/fixture.png"),
          url: (rel) => `markd-asset://vault/${rel}`,
        },
        exportNote: async () => success(null),
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
          fetchMetadata: async (id) => {
            const item = bookmarks.find((bookmark) => bookmark.id === id)!;
            const updated = { ...item, metaFetched: true };
            bookmarks = bookmarks.map((bookmark) => bookmark.id === id ? updated : bookmark);
            return success({ snapshot: { todos, todoTags, bookmarks, bookmarkTags }, item: updated });
          },
          remove: async (id) => {
            bookmarks = bookmarks.filter((bookmark) => bookmark.id !== id);
            return success({ todos, todoTags, bookmarks, bookmarkTags });
          },
          export: async () => success(null),
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

    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          clipboard.push(value);
        },
      },
    });
    Object.assign(window, {
      __MARKD_TEST__: { clipboard, operations, notes, openedExternalUrls },
    });
    function remapTree(
      nodes: import("@/lib/types").TreeNode[],
      rel: string,
      next: string,
    ): import("@/lib/types").TreeNode[] {
      return nodes.map((node) => {
        if (node.rel !== rel && !node.rel.startsWith(`${rel}/`)) {
          return node.children ? { ...node, children: remapTree(node.children, rel, next) } : node;
        }
        const remappedRel = next + node.rel.slice(rel.length);
        return {
          ...node,
          name: remappedRel.slice(remappedRel.lastIndexOf("/") + 1),
          rel: remappedRel,
          children: node.children ? remapTree(node.children, rel, next) : node.children,
        };
      });
    }

    function moveTreeEntry(
      nodes: import("@/lib/types").TreeNode[],
      rel: string,
      next: string,
    ): import("@/lib/types").TreeNode[] {
      let moved: import("@/lib/types").TreeNode | null = null;
      const remove = (items: import("@/lib/types").TreeNode[]) =>
        items.flatMap((node): import("@/lib/types").TreeNode[] => {
          if (node.rel === rel) {
            moved = remapTree([node], rel, next)[0] ?? null;
            return [];
          }
          return [node.children ? { ...node, children: remove(node.children) } : node];
        });
      const without = remove(nodes);
      if (!moved) return without;
      const parent = next.includes("/") ? next.slice(0, next.lastIndexOf("/")) : "";
      if (!parent) return [...without, moved];
      const insert = (items: import("@/lib/types").TreeNode[]): import("@/lib/types").TreeNode[] =>
        items.map((node) =>
          node.rel === parent
            ? { ...node, children: [...(node.children ?? []), moved!] }
            : node.children
              ? { ...node, children: insert(node.children) }
              : node,
        );
      return insert(without);
    }

    function withCollisionSuffix(name: string): string {
      const dot = name.lastIndexOf(".");
      return dot > 0 ? `${name.slice(0, dot)} 2${name.slice(dot)}` : `${name} 2`;
    }

    function insertTreeEntry(
      nodes: import("@/lib/types").TreeNode[],
      parent: string,
      entry: import("@/lib/types").TreeNode,
    ): import("@/lib/types").TreeNode[] {
      if (!parent) return [...nodes, entry];
      return nodes.map((node) =>
        node.rel === parent
          ? { ...node, children: [...(node.children ?? []), entry] }
          : node.children
            ? { ...node, children: insertTreeEntry(node.children, parent, entry) }
            : node,
      );
    }
  }, options);
}
