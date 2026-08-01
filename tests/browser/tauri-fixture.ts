import type { Page } from "@playwright/test";

type TauriFixtureOptions = {
  pinnedFolder?: boolean;
  taggedTodos?: boolean;
};

export async function installTauriFixture(
  page: Page,
  options: TauriFixtureOptions = {},
) {
  await page.addInitScript((fixtureOptions) => {
    let nextCallbackId = 1;
    const callbacks = new Map<
      number,
      { callback: (data: unknown) => void; once: boolean }
    >();
    const tree = [
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
    let pins = fixtureOptions.pinnedFolder ? ["Projects"] : [];
    const clipboard: string[] = [];
    const notes = new Map([
      [
        "README.md",
        "---\nfixture: preserved\n---\n# README\n\nOctane + pnpm verification.",
      ],
      ["Projects/Alpha.md", "# Alpha\n\nSecond live editor."],
    ]);
    const commands: Array<{ command: string; args: Record<string, unknown> }> = [];

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
            const tags = Array.isArray(args.tags)
              ? args.tags.map((tag) => String(tag))
              : [];
            todos = todos.map((todo) =>
              todo.id === id ? { ...todo, tags } : todo,
            );
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
    Object.assign(window, { __MARKD_TEST__: { clipboard, commands, notes } });
  }, options);
}
