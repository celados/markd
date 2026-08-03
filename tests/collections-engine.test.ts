import { afterEach, describe, expect, test } from "vitest";
import { access, mkdtemp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CollectionsEngine } from "../electron/collections-engine";

const scratchPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    scratchPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("Collections Engine", () => {
  test("persists Todo and Bookmark CRUD in Vault App Data", async () => {
    const root = await createVault();
    const engine = new CollectionsEngine(
      () => "fixed-id",
      () => 100,
    );
    await engine.open(root);

    const todo = await engine.createTodo("Ship it", ["Work"]);
    const bookmark = await engine.createBookmark("example.com", ["Later"]);
    await engine.changeTodo(todo.item.id, { type: "toggle" });
    await engine.changeBookmark(bookmark.item.id, { type: "title", title: "Example" });

    expect(await engine.snapshot()).toEqual({
      todos: [expect.objectContaining({ text: "Ship it", done: true, tags: ["work"] })],
      todoTags: ["work"],
      bookmarks: [
        expect.objectContaining({ url: "https://example.com", title: "Example", tags: ["later"] }),
      ],
      bookmarkTags: ["later"],
    });
    expect(JSON.parse(await readFile(join(root, ".markd", "collections.json"), "utf8")))
      .toEqual(expect.objectContaining({
        todos: [expect.objectContaining({ text: "Ship it", done: true })],
        bookmarks: [expect.objectContaining({ title: "Example" })],
      }));
  });

  test("switches Vault ownership and survives a utility-style restart", async () => {
    const first = await createVault();
    const second = await createVault();
    const writer = new CollectionsEngine(
      () => "todo-1",
      () => 1,
    );
    await writer.open(first);
    await writer.createTodo("First Vault", []);
    await writer.open(second);
    expect(await writer.snapshot()).toEqual({
      todos: [],
      todoTags: [],
      bookmarks: [],
      bookmarkTags: [],
    });

    const restarted = new CollectionsEngine(
      () => "unused",
      () => 2,
    );
    await restarted.open(first);
    expect((await restarted.snapshot()).todos[0]?.text).toBe("First Vault");
  });

  test("loads pre-tag Collection files using the legacy storage defaults", async () => {
    const root = await createVault();
    await writeFile(
      join(root, ".markd", "todos.json"),
      JSON.stringify([{ id: "old-todo", text: "Old", done: false, createdAt: 1 }]),
    );
    await writeFile(
      join(root, ".markd", "bookmarks.json"),
      JSON.stringify([{ id: "old-bookmark", url: "https://example.com", title: "Example", createdAt: 2 }]),
    );
    const engine = new CollectionsEngine(() => "unused", () => 3);
    await engine.open(root);

    expect(await engine.snapshot()).toEqual({
      todos: [expect.objectContaining({ completedAt: null, tags: [] })],
      todoTags: [],
      bookmarks: [expect.objectContaining({ image: null, favicon: null, metaFetched: false, tags: [] })],
      bookmarkTags: [],
    });
    expect(JSON.parse(await readFile(join(root, ".markd", "collections.json"), "utf8")))
      .toEqual(expect.objectContaining({
        todos: [expect.objectContaining({ id: "old-todo" })],
        bookmarks: [expect.objectContaining({ id: "old-bookmark" })],
      }));
  });

  test("keeps the previous coherent snapshot when an atomic commit fails", async () => {
    const root = await createVault();
    const seed = new CollectionsEngine(() => "todo-1", () => 1);
    await seed.open(root);
    await seed.createTodo("Durable", ["kept"]);
    const before = await readFile(join(root, ".markd", "collections.json"), "utf8");

    const faulty = new CollectionsEngine(
      () => "bookmark-1",
      () => 2,
      async (target, content) => {
        await writeFile(`${target}.fault`, content);
        throw new Error("injected commit failure");
      },
    );
    await faulty.open(root);
    await expect(faulty.createBookmark("example.com", ["new"]))
      .rejects.toEqual(expect.objectContaining({ kind: "COLLECTION_STORE_WRITE_FAILED" }));

    expect(await readFile(join(root, ".markd", "collections.json"), "utf8")).toBe(before);
    expect(await faulty.snapshot()).toEqual({
      todos: [expect.objectContaining({ text: "Durable", tags: ["kept"] })],
      todoTags: ["kept"],
      bookmarks: [],
      bookmarkTags: [],
    });
  });

  test("retries legacy migration after the canonical commit fails", async () => {
    const root = await createVault();
    const todos = [{ id: "legacy", text: "Retry me", done: false, createdAt: 1 }];
    await writeFile(join(root, ".markd", "todos.json"), JSON.stringify(todos));
    await writeFile(join(root, ".markd", "todo_tags.json"), JSON.stringify(["legacy"]));
    const failing = new CollectionsEngine(
      () => "unused",
      () => 2,
      async () => { throw new Error("injected migration failure"); },
    );

    await expect(failing.open(root)).rejects.toEqual(
      expect.objectContaining({ kind: "COLLECTION_STORE_WRITE_FAILED" }),
    );
    await expect(access(join(root, ".markd", "collections.json"))).rejects.toBeDefined();
    expect(JSON.parse(await readFile(join(root, ".markd", "todos.json"), "utf8"))).toEqual(todos);

    const retry = new CollectionsEngine(() => "unused", () => 3, commitFile);
    await retry.open(root);
    expect(await retry.snapshot()).toEqual({
      todos: [expect.objectContaining({ id: "legacy", tags: [] })],
      todoTags: ["legacy"],
      bookmarks: [],
      bookmarkTags: [],
    });
  });

  test("tags invalid stores instead of silently replacing them", async () => {
    const root = await createVault();
    await writeFile(join(root, ".markd", "todos.json"), "{}\n");
    const engine = new CollectionsEngine(
      () => "id",
      () => 1,
    );
    await expect(engine.open(root)).rejects.toEqual(
      expect.objectContaining({ kind: "COLLECTION_STORE_INVALID" }),
    );

    await expect(engine.snapshot()).rejects.toEqual(
      expect.objectContaining({ kind: "NO_ACTIVE_VAULT" }),
    );
  });
});

async function createVault(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "markd-collections-"));
  scratchPaths.push(root);
  await mkdir(join(root, ".markd"));
  return root;
}

async function commitFile(target: string, content: string): Promise<void> {
  const temporary = `${target}.test.tmp`;
  await writeFile(temporary, content);
  await rename(temporary, target);
}
