import { appendFile, mkdir, readFile, readdir, realpath, rename, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import type { DesktopErrorData } from "./bridge-contract";
import { CollectionsEngine } from "./collections-engine";
import type { BookmarkChange, CollectionKind, TodoChange } from "./collections-domain";
import type { PinSnapshot, Theme, TreeNode, VaultSnapshot } from "../src/lib/types";

type NativeTrash = (root: string, path: string) => Promise<void>;

type AppConfig = {
  vaultPath?: string;
  theme?: Theme;
};

export class VaultEngineError extends Error {
  readonly kind: string;
  readonly details?: unknown;

  constructor(error: DesktopErrorData) {
    super(error.message);
    this.name = "VaultEngineError";
    this.kind = error.kind;
    this.details = error.details;
  }
}

export class VaultEngine {
  readonly #configFile: string;
  readonly #trash: NativeTrash;
  readonly #collections = new CollectionsEngine();
  #root: string | null = null;
  #theme: Theme = "system";

  constructor(configDir: string, trash: NativeTrash) {
    this.#configFile = join(configDir, "config.json");
    this.#trash = trash;
  }

  async startup(): Promise<VaultSnapshot | null> {
    if (this.#root) return this.snapshot();
    const config = await this.#readConfig();
    this.#theme = config.theme ?? "system";
    if (!config.vaultPath) return null;
    try {
      return await this.open(config.vaultPath, false);
    } catch (error) {
      if (error instanceof VaultEngineError && error.kind === "VAULT_MISSING") {
        return null;
      }
      throw error;
    }
  }

  async open(root: string, create: boolean): Promise<VaultSnapshot> {
    if (create) await mkdir(root, { recursive: true });
    const canonical = await canonicalDirectory(root);
    await mkdir(join(canonical, ".markd", "assets"), { recursive: true });
    const snapshot = await buildSnapshot(canonical, this.#theme);
    await this.#collections.validate(canonical);
    await this.#writeConfig({ vaultPath: canonical, theme: this.#theme });
    await this.#collections.activate(canonical);
    this.#root = canonical;
    return snapshot;
  }

  async snapshot(): Promise<VaultSnapshot> {
    const root = this.#requireRoot();
    return buildSnapshot(root, this.#theme);
  }

  collectionsSnapshot() {
    return this.#collections.snapshot();
  }

  createTodo(text: string, tags: string[]) {
    return this.#collections.createTodo(text, tags);
  }

  changeTodo(id: string, change: TodoChange) {
    return this.#collections.changeTodo(id, change);
  }

  removeTodo(id: string) {
    return this.#collections.removeTodo(id);
  }

  clearCompletedTodos() {
    return this.#collections.clearCompletedTodos();
  }

  createBookmark(url: string, tags: string[]) {
    return this.#collections.createBookmark(url, tags);
  }

  changeBookmark(id: string, change: BookmarkChange) {
    return this.#collections.changeBookmark(id, change);
  }

  removeBookmark(id: string) {
    return this.#collections.removeBookmark(id);
  }

  createCollectionTag(collection: CollectionKind, name: string) {
    return this.#collections.createTag(collection, name);
  }

  deleteCollectionTag(collection: CollectionKind, name: string) {
    return this.#collections.deleteTag(collection, name);
  }

  async createNote(
    dir: string,
    title: string,
    content: string,
  ): Promise<{ rel: string; snapshot: VaultSnapshot }> {
    const root = this.#requireRoot();
    const targetDir = await this.#existingPath(dir, "folder");
    const stem = sanitizeName(title);
    let target = join(targetDir, `${stem}.md`);
    for (let suffix = 2; await exists(target); suffix += 1) {
      target = join(targetDir, `${stem} ${suffix}.md`);
    }
    await writeFile(target, content, { flag: "wx" });
    return { rel: toVaultRel(root, target), snapshot: await this.snapshot() };
  }

  async captureCreate(
    title: string,
    content: string,
  ): Promise<{ rel: string; snapshot: VaultSnapshot }> {
    return this.createNote("", title, content);
  }

  async captureAppend(
    rel: string,
    content: string,
  ): Promise<{ rel: string; snapshot: VaultSnapshot }> {
    const path = await this.#existingPath(rel, "note");
    const current = await readFile(path, "utf8");
    await appendFile(path, `${current.length > 0 && !current.endsWith("\n") ? "\n" : ""}${content}`);
    return { rel: toVaultRel(this.#requireRoot(), path), snapshot: await this.snapshot() };
  }

  async readNote(rel: string): Promise<string> {
    const path = await this.#existingPath(rel, "note");
    return readFile(path, "utf8");
  }

  async writeNote(rel: string, content: string): Promise<void> {
    const path = await this.#existingPath(rel, "note");
    await writeFile(path, content);
  }

  async moveToTrash(rel: string): Promise<{ snapshot: VaultSnapshot }> {
    const path = await this.#existingPath(rel, "entry");
    await this.#trash(this.#requireRoot(), path);
    try {
      await this.#removePinsUnder(rel);
    } catch (error) {
      // Trash already succeeded and cannot be rolled back. A failed cleanup is
      // surfaced as an explicit stale Pin on the next load, not a false delete failure.
      console.error("[markd-engine] failed to clean Pins after Trash", error);
    }
    return { snapshot: await this.snapshot() };
  }

  async resolveNotePath(rel: string): Promise<string> {
    return this.#existingPath(rel, "note");
  }

  async listPins(): Promise<PinSnapshot> {
    const stored = dedupe(await this.#readPins());
    const active: Array<{ rel: string; folder: boolean }> = [];
    const stale: string[] = [];
    for (const rel of stored) {
      try {
        const path = await this.#existingPath(rel, "pin");
        active.push({ rel, folder: (await stat(path)).isDirectory() });
      } catch (error) {
        if (
          error instanceof VaultEngineError &&
          ["NOT_FOUND", "INVALID_PATH"].includes(error.kind)
        ) {
          stale.push(rel);
          continue;
        }
        throw error;
      }
    }
    const folderPins = active.filter((pin) => pin.folder).map((pin) => pin.rel);
    return {
      pins: active
        .map((pin) => pin.rel)
        .filter(
          (rel) => !folderPins.some((folder) => rel !== folder && rel.startsWith(`${folder}/`)),
        ),
      stale,
    };
  }

  async pin(rel: string): Promise<PinSnapshot> {
    if (rel === "") {
      throw domainError("INVALID_PATH", "The Vault root cannot be pinned.");
    }
    const path = await this.#existingPath(rel, "pin");
    const folder = (await stat(path)).isDirectory();
    const current = await this.listPins();
    for (const pin of current.pins) {
      const candidate = await this.#existingPath(pin, "pin");
      if ((await stat(candidate)).isDirectory() && rel.startsWith(`${pin}/`)) {
        return current;
      }
    }
    let pins = current.pins;
    if (folder) pins = pins.filter((pin) => !pin.startsWith(`${rel}/`));
    if (!pins.includes(rel)) pins = [rel, ...pins];
    await this.#writePins([...pins, ...current.stale]);
    return this.listPins();
  }

  async unpin(rel: string): Promise<PinSnapshot> {
    await this.#writePins((await this.#readPins()).filter((pin) => pin !== rel));
    return this.listPins();
  }

  async #existingPath(rel: string, expected: "folder" | "note" | "entry" | "pin"): Promise<string> {
    const root = this.#requireRoot();
    const candidate = resolveVaultRel(root, rel);
    let canonical: string;
    try {
      canonical = await realpath(candidate);
    } catch {
      throw domainError("NOT_FOUND", `Vault entry does not exist: ${rel}`);
    }
    if (normalize(candidate) !== normalize(canonical)) {
      throw domainError("INVALID_PATH", `Invalid Vault path: ${rel}`);
    }
    assertInside(root, canonical, rel);
    const metadata = await stat(canonical);
    const valid =
      expected === "entry" ||
      (expected === "pin" &&
        (metadata.isDirectory() || (metadata.isFile() && canonical.endsWith(".md")))) ||
      (expected === "folder" && metadata.isDirectory()) ||
      (expected === "note" && metadata.isFile() && canonical.endsWith(".md"));
    if (!valid) throw domainError("INVALID_PATH", `Invalid Vault path: ${rel}`);
    return canonical;
  }

  async #readPins(): Promise<string[]> {
    try {
      const input: unknown = JSON.parse(
        await readFile(join(this.#requireRoot(), ".markd", "pins.json"), "utf8"),
      );
      if (!Array.isArray(input) || !input.every((value) => typeof value === "string")) {
        throw domainError("PIN_STORE_INVALID", "The Vault Pin store is invalid.");
      }
      return input;
    } catch (error) {
      if (error instanceof VaultEngineError) throw error;
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw domainError("PIN_STORE_INVALID", "The Vault Pin store could not be read.");
    }
  }

  async #writePins(pins: string[]): Promise<void> {
    const target = join(this.#requireRoot(), ".markd", "pins.json");
    const temporary = `${target}.tmp`;
    await writeFile(temporary, `${JSON.stringify(dedupe(pins), null, 2)}\n`);
    await rename(temporary, target);
  }

  async #removePinsUnder(rel: string): Promise<void> {
    const pins = await this.#readPins();
    const next = pins.filter((pin) => pin !== rel && !pin.startsWith(`${rel}/`));
    if (next.length !== pins.length) await this.#writePins(next);
  }

  #requireRoot(): string {
    if (!this.#root) throw domainError("NO_ACTIVE_VAULT", "No Vault is open.");
    return this.#root;
  }

  async #readConfig(): Promise<AppConfig> {
    try {
      const input: unknown = JSON.parse(await readFile(this.#configFile, "utf8"));
      if (!input || typeof input !== "object") return {};
      const value = input as Record<string, unknown>;
      const theme = ["system", "light", "dark"].includes(String(value.theme))
        ? (value.theme as Theme)
        : undefined;
      return {
        vaultPath: typeof value.vaultPath === "string" ? value.vaultPath : undefined,
        theme,
      };
    } catch {
      return {};
    }
  }

  async #writeConfig(config: AppConfig): Promise<void> {
    await mkdir(dirname(this.#configFile), { recursive: true });
    await writeFile(this.#configFile, `${JSON.stringify(config, null, 2)}\n`);
  }
}

async function buildSnapshot(root: string, theme: Theme): Promise<VaultSnapshot> {
  return {
    root,
    name: basename(root),
    tree: await scanBootstrapTree(root),
    theme,
  };
}

async function canonicalDirectory(path: string): Promise<string> {
  try {
    const canonical = await realpath(path);
    if (!(await stat(canonical)).isDirectory()) {
      throw domainError("VAULT_MISSING", `Vault is not a folder: ${path}`);
    }
    return canonical;
  } catch (error) {
    if (error instanceof VaultEngineError) throw error;
    throw domainError("VAULT_MISSING", `Vault folder does not exist: ${path}`);
  }
}

function resolveVaultRel(root: string, rel: string): string {
  if (rel === "") return root;
  const parts = rel.split(/[\\/]/);
  if (
    parts.some(
      (part) =>
        !part || part === "." || part === ".." || part === "node_modules" || part.startsWith("."),
    ) ||
    (parts.length > 0 && ["AGENTS.md", "CLAUDE.md"].includes(parts[0]!))
  ) {
    throw domainError("INVALID_PATH", `Invalid Vault path: ${rel}`);
  }
  const candidate = resolve(root, ...parts);
  assertInside(root, candidate, rel);
  return candidate;
}

function assertInside(root: string, candidate: string, rel: string): void {
  const offset = relative(root, candidate);
  if (offset === "" || (!offset.startsWith(`..${sep}`) && offset !== ".." && !isAbsolute(offset))) {
    return;
  }
  throw domainError("INVALID_PATH", `Invalid Vault path: ${rel}`);
}

async function scanBootstrapTree(root: string): Promise<TreeNode[]> {
  // Phase 2 needs one coherent initial tree before fff lands. Keep this walker
  // deliberately stateless so #5 can delete it instead of inheriting a rival index.
  const walk = async (dir: string): Promise<TreeNode[]> => {
    const entries = await readdir(dir, { withFileTypes: true });
    const nodes: TreeNode[] = [];
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      if (dir === root && ["AGENTS.md", "CLAUDE.md"].includes(entry.name)) continue;
      const path = join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      const rel = toVaultRel(root, path);
      const modifiedMs = (await stat(path)).mtimeMs;
      if (entry.isDirectory()) {
        nodes.push({
          name: entry.name,
          rel,
          kind: "folder",
          children: await walk(path),
          modifiedMs,
        });
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        nodes.push({ name: entry.name, rel, kind: "note", modifiedMs });
      }
    }
    return nodes.sort((left, right) => {
      if (left.kind !== right.kind) return left.kind === "folder" ? -1 : 1;
      return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
    });
  };
  return walk(root);
}

function toVaultRel(root: string, path: string): string {
  return relative(root, path).split(sep).join("/");
}

function sanitizeName(value: string): string {
  const sanitized = value.trim().replace(/[\\/:*?"<>|]/g, "-");
  return sanitized || "Untitled";
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function domainError(kind: string, message: string): VaultEngineError {
  return new VaultEngineError({ kind, message });
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values));
}
