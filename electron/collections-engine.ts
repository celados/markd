import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as v from "valibot";
import { bookmarkSchema, collectionsSnapshotSchema, todoSchema } from "./bridge-contract";
import {
  CollectionDomainError,
  addBookmark,
  addTodo,
  changeBookmark,
  changeTodo,
  clearCompletedTodos,
  createCollectionTag,
  deleteCollectionTag,
  emptyCollections,
  removeBookmark,
  removeTodo,
  type BookmarkChange,
  type CollectionKind,
  type CollectionsSnapshot,
  type TodoChange,
} from "./collections-domain";

type Identity = () => string;
type Clock = () => number;
type AtomicCommit = (target: string, content: string) => Promise<void>;

const storeSchemas = {
  todos: v.array(todoSchema),
  todoTags: v.array(v.string()),
  bookmarks: v.array(bookmarkSchema),
  bookmarkTags: v.array(v.string()),
};

const legacyStoreFiles = {
  todos: "todos.json",
  todoTags: "todo_tags.json",
  bookmarks: "bookmarks.json",
  bookmarkTags: "bookmark_tags.json",
} as const;

const canonicalStoreFile = "collections.json";

export class CollectionsEngineError extends Error {
  readonly kind: string;
  readonly details?: unknown;

  constructor(kind: string, message: string, details?: unknown) {
    super(message);
    this.name = "CollectionsEngineError";
    this.kind = kind;
    this.details = details;
  }
}

export class CollectionsEngine {
  readonly #identity: Identity;
  readonly #clock: Clock;
  readonly #commit: AtomicCommit;
  #root: string | null = null;
  #tail: Promise<void> = Promise.resolve();

  constructor(
    identity: Identity = randomUUID,
    clock: Clock = Date.now,
    commit: AtomicCommit = atomicCommit,
  ) {
    this.#identity = identity;
    this.#clock = clock;
    this.#commit = commit;
  }

  open(root: string): Promise<void> {
    return this.validate(root).then(() => this.activate(root));
  }

  validate(root: string): Promise<void> {
    return this.#run(async () => {
      await mkdir(join(root, ".markd"), { recursive: true });
      await this.#readSnapshot(root);
    });
  }

  activate(root: string): Promise<void> {
    return this.#run(async () => {
      // Validation and config persistence happen first, so this assignment is
      // the no-fail commit point shared with VaultEngine's active root.
      this.#root = root;
    });
  }

  snapshot(): Promise<CollectionsSnapshot> {
    return this.#run(() => this.#readSnapshot(this.#requireRoot()));
  }

  createTodo(text: string, tags: string[]) {
    return this.#mutate((snapshot) =>
      addTodo(snapshot, text, tags, { id: this.#identity(), now: this.#clock() }),
    );
  }

  changeTodo(id: string, change: TodoChange) {
    return this.#mutate((snapshot) => changeTodo(snapshot, id, change, this.#clock()));
  }

  removeTodo(id: string): Promise<CollectionsSnapshot> {
    return this.#mutateSnapshot((snapshot) => removeTodo(snapshot, id));
  }

  clearCompletedTodos(): Promise<CollectionsSnapshot> {
    return this.#mutateSnapshot(clearCompletedTodos);
  }

  createBookmark(url: string, tags: string[]) {
    return this.#mutate((snapshot) =>
      addBookmark(snapshot, url, tags, { id: this.#identity(), now: this.#clock() }),
    );
  }

  changeBookmark(id: string, change: BookmarkChange) {
    return this.#mutate((snapshot) => changeBookmark(snapshot, id, change));
  }

  removeBookmark(id: string): Promise<CollectionsSnapshot> {
    return this.#mutateSnapshot((snapshot) => removeBookmark(snapshot, id));
  }

  createTag(collection: CollectionKind, name: string): Promise<CollectionsSnapshot> {
    return this.#mutateSnapshot((snapshot) => createCollectionTag(snapshot, collection, name));
  }

  deleteTag(collection: CollectionKind, name: string): Promise<CollectionsSnapshot> {
    return this.#mutateSnapshot((snapshot) => deleteCollectionTag(snapshot, collection, name));
  }

  #mutate<T extends { snapshot: CollectionsSnapshot }>(
    transition: (snapshot: CollectionsSnapshot) => T,
  ): Promise<T> {
    return this.#run(async () => {
      const root = this.#requireRoot();
      let result: T;
      try {
        result = transition(await this.#readSnapshot(root));
      } catch (error) {
        throw taggedDomainError(error);
      }
      await this.#writeSnapshot(root, result.snapshot);
      return result;
    });
  }

  #mutateSnapshot(
    transition: (snapshot: CollectionsSnapshot) => CollectionsSnapshot,
  ): Promise<CollectionsSnapshot> {
    return this.#mutate((snapshot) => {
      const next = transition(snapshot);
      return { snapshot: next };
    }).then((result) => result.snapshot);
  }

  #run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#tail.then(operation, operation);
    this.#tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  #requireRoot(): string {
    if (!this.#root) {
      throw new CollectionsEngineError("NO_ACTIVE_VAULT", "No Vault is open.");
    }
    return this.#root;
  }

  async #readSnapshot(root: string): Promise<CollectionsSnapshot> {
    const appData = join(root, ".markd");
    const canonical = join(appData, canonicalStoreFile);
    try {
      const input: unknown = JSON.parse(await readFile(canonical, "utf8"));
      const parsed = v.safeParse(collectionsSnapshotSchema, input);
      if (!parsed.success) throw new Error("schema mismatch");
      return parsed.output;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw new CollectionsEngineError(
          "COLLECTION_STORE_INVALID",
          `The Vault Collection store could not be read: ${canonicalStoreFile}`,
          { file: canonicalStoreFile },
        );
      }
    }

    const snapshot = await this.#readLegacySnapshot(appData);
    await this.#writeSnapshot(root, snapshot);
    return snapshot;
  }

  async #readLegacySnapshot(appData: string): Promise<CollectionsSnapshot> {
    const empty = emptyCollections();
    const entries = await Promise.all(
      (Object.keys(legacyStoreFiles) as Array<keyof CollectionsSnapshot>).map(async (key) => {
        const path = join(appData, legacyStoreFiles[key]);
        try {
          const input: unknown = JSON.parse(await readFile(path, "utf8"));
          const parsed = v.safeParse(storeSchemas[key], input);
          if (!parsed.success) throw new Error("schema mismatch");
          return [key, parsed.output] as const;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            return [key, empty[key]] as const;
          }
          throw new CollectionsEngineError(
            "COLLECTION_STORE_INVALID",
            `The Vault Collection store could not be read: ${legacyStoreFiles[key]}`,
            { file: legacyStoreFiles[key] },
          );
        }
      }),
    );
    return Object.fromEntries(entries) as CollectionsSnapshot;
  }

  async #writeSnapshot(root: string, snapshot: CollectionsSnapshot): Promise<void> {
    const appData = join(root, ".markd");
    await mkdir(appData, { recursive: true });
    const target = join(appData, canonicalStoreFile);
    try {
      await this.#commit(target, `${JSON.stringify(snapshot, null, 2)}\n`);
    } catch (error) {
      throw new CollectionsEngineError(
        "COLLECTION_STORE_WRITE_FAILED",
        `The Vault Collection store could not be written: ${canonicalStoreFile}`,
        { file: canonicalStoreFile, cause: error instanceof Error ? error.message : String(error) },
      );
    }
  }
}

async function atomicCommit(target: string, content: string): Promise<void> {
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  let committed = false;
  try {
    await writeFile(temporary, content);
    await rename(temporary, target);
    committed = true;
  } finally {
    if (!committed) await rm(temporary, { force: true }).catch(() => undefined);
  }
}

function taggedDomainError(error: unknown): unknown {
  if (error instanceof CollectionDomainError) {
    return new CollectionsEngineError(error.kind, error.message);
  }
  return error;
}
