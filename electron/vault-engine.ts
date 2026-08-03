import { randomUUID } from "node:crypto";
import {
  appendFile,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import type { DesktopErrorData } from "./bridge-contract";
import { CollectionsEngine } from "./collections-engine";
import {
  bookmarksToMarkdown,
  type BookmarkChange,
  type CollectionKind,
  type TodoChange,
} from "./collections-domain";
import type { PinSnapshot, Theme, TreeNode, VaultSnapshot } from "../src/lib/types";
import {
  atomicWriteText,
  NativeContentError,
  validateAssetContent,
} from "./native-content";

export type ExportPreparation = {
  suggestedName: string;
  content: string;
};

export type NativeVaultOperations = {
  moveToTrash: (root: string, path: string) => Promise<void>;
  stageAssetRoot: (root: string, assetRoot: string) => Promise<string>;
  commitAssetRoot: (stageId: string) => Promise<void>;
  rollbackAssetRoot: (stageId: string) => Promise<void>;
  saveExport: (preparation: ExportPreparation) => Promise<string | null>;
};

type AppConfig = {
  vaultPath?: string;
  theme?: Theme;
};

type ConfigCommit = (path: string, content: string) => Promise<void>;

type CaptureAppendProvenance = {
  events: Array<{
    beforeContent: string;
    content: string;
    afterContent: string;
  }>;
  currentContent: string;
  device: number;
  inode: number;
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
  readonly #native: NativeVaultOperations;
  readonly #commitConfig: ConfigCommit;
  readonly #collections = new CollectionsEngine();
  readonly #captureAppends = new Map<string, CaptureAppendProvenance>();
  #root: string | null = null;
  #assetRoot: string | null = null;
  #theme: Theme = "system";
  #fatalError: VaultEngineError | null = null;

  constructor(
    configDir: string,
    native: NativeVaultOperations,
    commitConfig: ConfigCommit = atomicWriteText,
  ) {
    this.#configFile = join(configDir, "config.json");
    this.#native = native;
    this.#commitConfig = commitConfig;
  }

  async startup(): Promise<VaultSnapshot | null> {
    this.#assertOperational();
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
    this.#assertOperational();
    if (create) await mkdir(root, { recursive: true });
    const canonical = await canonicalDirectory(root);
    const assetRoot = await canonicalAssetRoot(canonical);
    const snapshot = await buildSnapshot(canonical, this.#theme);
    await this.#collections.validate(canonical);
    const previousRoot = this.#root;
    const previousAssetRoot = this.#assetRoot;
    const previousConfig = await this.#readConfigText();
    let stageId: string;
    try {
      // Main validates and stages first, but keeps serving the old root until
      // the utility has committed its config and in-memory state.
      stageId = await this.#native.stageAssetRoot(canonical, assetRoot);
    } catch (error) {
      throw nativeOperationError(error);
    }

    try {
      await this.#writeConfig({ vaultPath: canonical, theme: this.#theme });
      await this.#collections.activate(canonical);
      this.#root = canonical;
      this.#assetRoot = assetRoot;
      await this.#native.commitAssetRoot(stageId);
      // Provenance is scoped to one activated Vault. Clear only after every
      // participant commits so a failed switch preserves expectedContent state.
      this.#captureAppends.clear();
      return snapshot;
    } catch (error) {
      this.#root = previousRoot;
      this.#assetRoot = previousAssetRoot;
      const rollbackParticipants = [
        ["collections", this.#collections.activate(previousRoot)],
        ["config", this.#restoreConfig(previousConfig)],
        ["native", this.#native.rollbackAssetRoot(stageId)],
      ] as const;
      const rollbackResults = await Promise.allSettled(
        rollbackParticipants.map(([, operation]) => operation),
      );
      const rollbackFailures = rollbackResults.flatMap((result, index) =>
        result.status === "rejected"
          ? [{
              participant: rollbackParticipants[index]![0],
              error: describeError(result.reason),
            }]
          : [],
      );
      if (rollbackFailures.length > 0) {
        const fatal = domainError(
          "VAULT_ROLLBACK_FAILED",
          "Vault activation failed and could not be rolled back safely. Restart Markd before continuing.",
          {
            original: describeError(error),
            rollbackFailures,
          },
        );
        // Once durable and in-memory roots may disagree, no operation can be
        // reported successful until a new utility process reconstructs state.
        this.#fatalError = fatal;
        throw fatal;
      }
      throw nativeOperationError(error);
    }
  }

  async snapshot(): Promise<VaultSnapshot> {
    const root = this.#requireRoot();
    return buildSnapshot(root, this.#theme);
  }

  collectionsSnapshot() {
    this.#assertOperational();
    return this.#collections.snapshot();
  }

  createTodo(text: string, tags: string[]) {
    this.#assertOperational();
    return this.#collections.createTodo(text, tags);
  }

  changeTodo(id: string, change: TodoChange) {
    this.#assertOperational();
    return this.#collections.changeTodo(id, change);
  }

  removeTodo(id: string) {
    this.#assertOperational();
    return this.#collections.removeTodo(id);
  }

  clearCompletedTodos() {
    this.#assertOperational();
    return this.#collections.clearCompletedTodos();
  }

  createBookmark(url: string, tags: string[]) {
    this.#assertOperational();
    return this.#collections.createBookmark(url, tags);
  }

  changeBookmark(id: string, change: BookmarkChange) {
    this.#assertOperational();
    return this.#collections.changeBookmark(id, change);
  }

  removeBookmark(id: string) {
    this.#assertOperational();
    return this.#collections.removeBookmark(id);
  }

  createCollectionTag(collection: CollectionKind, name: string) {
    this.#assertOperational();
    return this.#collections.createTag(collection, name);
  }

  deleteCollectionTag(collection: CollectionKind, name: string) {
    this.#assertOperational();
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
    if (content.trim().length === 0) {
      throw domainError("INVALID_CAPTURE", "Captured content cannot be empty.");
    }
    const path = await this.#existingPath(rel, "note");
    const current = await readFile(path, "utf8");
    const next = appendCapture(current, content);
    await appendFile(path, next.slice(current.length));
    const metadata = await stat(path);
    const previous = this.#captureAppends.get(path);
    const continuesPrevious =
      previous?.currentContent === current &&
      previous.device === metadata.dev &&
      previous.inode === metadata.ino;
    this.#captureAppends.set(path, {
      events: [
        ...(continuesPrevious ? previous.events : []),
        { beforeContent: current, content, afterContent: next },
      ],
      currentContent: next,
      device: metadata.dev,
      inode: metadata.ino,
    });
    return { rel: toVaultRel(this.#requireRoot(), path), snapshot: await this.snapshot() };
  }

  async readNote(rel: string): Promise<string> {
    const path = await this.#existingPath(rel, "note");
    return readFile(path, "utf8");
  }

  async writeNote(
    rel: string,
    content: string,
    expectedContent: string,
  ): Promise<string> {
    const path = await this.#existingPath(rel, "note");
    const current = await readFile(path, "utf8");
    const provenance = this.#captureAppends.get(path);
    this.#captureAppends.delete(path);
    let committed = content;
    if (current !== expectedContent) {
      const metadata = await stat(path);
      const merged = provenance
        ? replayProvenCaptureAppends(
            provenance,
            expectedContent,
            content,
            current,
          )
        : null;
      if (
        !provenance ||
        merged === null ||
        provenance.device !== metadata.dev ||
        provenance.inode !== metadata.ino
      ) {
        throw domainError(
          "STALE_NOTE_WRITE",
          "The Note changed before this edit could be saved.",
        );
      }
      committed = merged;
    }
    await writeFile(path, committed);
    return committed;
  }

  async saveAsset(data: string, extension: string): Promise<string> {
    this.#requireRoot();
    const assetRoot = this.#assetRoot;
    if (!assetRoot) throw domainError("NO_ACTIVE_VAULT", "No Vault is open.");
    let validated: Awaited<ReturnType<typeof validateAssetContent>>;
    try {
      validated = await validateAssetContent(data, extension);
    } catch (error) {
      if (error instanceof NativeContentError) {
        throw domainError(error.kind, error.message);
      }
      throw error;
    }
    const fileName = `${randomUUID()}.${validated.extension}`;
    await writeFile(join(assetRoot, fileName), validated.bytes, { flag: "wx" });
    return `.markd/assets/${fileName}`;
  }

  async exportNote(rel: string, content: string): Promise<string | null> {
    const path = await this.#existingPath(rel, "note");
    return this.#native.saveExport({ suggestedName: basename(path), content });
  }

  async exportBookmarks(): Promise<string | null> {
    this.#assertOperational();
    const snapshot = await this.#collections.snapshot();
    return this.#native.saveExport({
      suggestedName: "bookmarks.md",
      content: bookmarksToMarkdown(snapshot.bookmarks),
    });
  }

  async moveToTrash(rel: string): Promise<{ snapshot: VaultSnapshot }> {
    const path = await this.#existingPath(rel, "entry");
    await this.#native.moveToTrash(this.#requireRoot(), path);
    this.#invalidateCaptureAppendsUnder(path);
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

  #invalidateCaptureAppendsUnder(path: string): void {
    for (const candidate of this.#captureAppends.keys()) {
      if (candidate === path || candidate.startsWith(`${path}${sep}`)) {
        this.#captureAppends.delete(candidate);
      }
    }
  }

  #requireRoot(): string {
    this.#assertOperational();
    if (!this.#root) throw domainError("NO_ACTIVE_VAULT", "No Vault is open.");
    return this.#root;
  }

  #assertOperational(): void {
    if (this.#fatalError) throw this.#fatalError;
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
    await this.#commitConfig(this.#configFile, `${JSON.stringify(config, null, 2)}\n`);
  }

  async #readConfigText(): Promise<string | null> {
    try {
      return await readFile(this.#configFile, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async #restoreConfig(content: string | null): Promise<void> {
    if (content === null) {
      await rm(this.#configFile, { force: true });
      return;
    }
    await this.#commitConfig(this.#configFile, content);
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

async function canonicalAssetRoot(root: string): Promise<string> {
  const candidate = join(root, ".markd", "assets");
  await mkdir(candidate, { recursive: true });
  const canonical = await realpath(candidate);
  if (normalize(candidate) !== normalize(canonical)) {
    throw domainError("INVALID_PATH", "The Vault asset folder cannot contain symbolic links.");
  }
  assertInside(root, canonical, ".markd/assets");
  return canonical;
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

function domainError(kind: string, message: string, details?: unknown): VaultEngineError {
  return new VaultEngineError({ kind, message, details });
}

function describeError(error: unknown): DesktopErrorData {
  const tagged = error as { kind?: unknown; details?: unknown };
  return {
    kind: typeof tagged?.kind === "string" ? tagged.kind : "UNKNOWN",
    message: error instanceof Error ? error.message : String(error),
    ...(tagged?.details === undefined ? {} : { details: tagged.details }),
  };
}

function appendCapture(current: string, content: string): string {
  const boundary = current.length > 0 && !current.endsWith("\n") ? "\n" : "";
  return `${current}${boundary}${content}`;
}

function replayProvenCaptureAppends(
  provenance: CaptureAppendProvenance,
  expectedContent: string,
  draft: string,
  diskContent: string,
): string | null {
  const firstUnseen = provenance.events.findIndex(
    (event) => event.beforeContent === expectedContent,
  );
  if (firstUnseen < 0) return null;

  let recorded = expectedContent;
  let committed = draft;
  for (const event of provenance.events.slice(firstUnseen)) {
    if (event.beforeContent !== recorded) return null;
    const after = appendCapture(recorded, event.content);
    if (event.afterContent !== after) return null;
    recorded = after;
    committed = appendCapture(committed, event.content);
  }
  return recorded === diskContent && provenance.currentContent === diskContent
    ? committed
    : null;
}

function nativeOperationError(error: unknown): VaultEngineError {
  if (error instanceof VaultEngineError) return error;
  return domainError(
    "NATIVE_OPERATION_FAILED",
    error instanceof Error ? error.message : String(error),
  );
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values));
}
