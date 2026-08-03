import { FileFinder, type FileFinderApi, type WatchEvent } from "@ff-labs/fff-node";
import { basename, relative, sep } from "node:path";
import type { Theme, TreeNode, VaultSnapshot } from "../src/lib/types";
import { reconcileManagedIgnore } from "./managed-ignore";
import { isAcceptedVaultRel } from "./vault-path-policy";

const SCAN_TIMEOUT_MS = 15_000;
const PAGE_SIZE = 4_096;

export type VaultChange = {
  kind: "created" | "modified" | "removed";
  rel: string;
};

export type VaultIndexEvent =
  | {
      kind: "replacement";
      indexEpoch: number;
      sequence: 0;
      snapshot: VaultSnapshot;
    }
  | {
      kind: "changes";
      indexEpoch: number;
      sequence: number;
      changes: VaultChange[];
    };

type IndexListener = (event: VaultIndexEvent) => void;

export class VaultIndex {
  readonly #root: string;
  readonly #theme: Theme;
  readonly #finder: FileFinderApi;
  readonly #listener: IndexListener;
  #indexEpoch = 1;
  #sequence = 0;
  #unsubscribe: (() => void) | null = null;
  #eventQueue = Promise.resolve();
  #destroyed = false;

  private constructor(
    root: string,
    theme: Theme,
    finder: FileFinderApi,
    listener: IndexListener,
  ) {
    this.#root = root;
    this.#theme = theme;
    this.#finder = finder;
    this.#listener = listener;
  }

  static async open(
    root: string,
    theme: Theme,
    listener: IndexListener = () => {},
    initialEpoch = 1,
  ): Promise<VaultIndex> {
    await reconcileManagedIgnore(root);
    const created = FileFinder.create({
      basePath: root,
      disableMmapCache: true,
      disableContentIndexing: false,
      followSymlinks: false,
    });
    if (!created.ok) throw new Error(`FFF initialization failed: ${created.error}`);

    const index = new VaultIndex(root, theme, created.value, listener);
    index.#indexEpoch = initialEpoch;
    try {
      await index.#waitForScan();
      const watched = created.value.watch((events) => index.#enqueue(events));
      if (!watched.ok) throw new Error(`FFF watcher failed: ${watched.error}`);
      index.#unsubscribe = watched.value;
      index.#emitReplacement(await index.snapshot());
      return index;
    } catch (error) {
      index.destroy();
      throw error;
    }
  }

  async snapshot(): Promise<VaultSnapshot> {
    const entries = allEntries(this.#finder);
    return {
      root: this.#root,
      name: basename(this.#root),
      tree: projectTree(entries),
      theme: this.#theme,
    };
  }

  async rescan(): Promise<void> {
    await this.#replaceSnapshot();
  }

  async waitForEntry(rel: string, present: boolean): Promise<void> {
    const deadline = Date.now() + SCAN_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const entries = allEntries(this.#finder);
      const prefix = `${rel}/`;
      const found = entries.files.some(
        (file) => file.rel === rel || file.rel.startsWith(prefix),
      ) || entries.directories.some(
        (directory) => directory === rel || directory.startsWith(prefix),
      );
      if (found === present) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`FFF index did not observe ${rel}.`);
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.#unsubscribe?.();
    this.#finder.destroy();
  }

  #enqueue(events: WatchEvent[]): void {
    this.#eventQueue = this.#eventQueue
      .then(() => this.#handleEvents(events))
      .catch((error: unknown) => {
        console.error("[markd-engine] Vault Index event failed", error);
      });
  }

  async #handleEvents(events: WatchEvent[]): Promise<void> {
    if (this.#destroyed) return;
    if (events.some((event) => event.kind === "rescan")) {
      await this.#replaceSnapshot();
      return;
    }

    const changes = events
      .map(normalizeChange(this.#root))
      .filter((change): change is VaultChange => change !== null);
    if (changes.length === 0) return;
    this.#sequence += 1;
    this.#listener({
      kind: "changes",
      indexEpoch: this.#indexEpoch,
      sequence: this.#sequence,
      changes,
    });
  }

  async #replaceSnapshot(): Promise<void> {
    await this.#waitForScan();
    await reconcileManagedIgnore(this.#root);
    // A replacement epoch is only truthful after a new matcher and full scan;
    // this also closes the callback-order race around native overflow events.
    unwrap(this.#finder.scanFiles(), "FFF rescan failed");
    await this.#waitForScan();
    this.#indexEpoch += 1;
    this.#sequence = 0;
    this.#emitReplacement(await this.snapshot());
  }

  async #waitForScan(): Promise<void> {
    const waited = await this.#finder.waitForScan(SCAN_TIMEOUT_MS);
    if (!waited.ok) throw new Error(`FFF scan failed: ${waited.error}`);
    if (!waited.value) throw new Error("FFF scan timed out.");
  }

  #emitReplacement(snapshot: VaultSnapshot): void {
    this.#listener({
      kind: "replacement",
      indexEpoch: this.#indexEpoch,
      sequence: 0,
      snapshot,
    });
  }
}

type IndexedEntries = {
  files: Array<{ rel: string; modifiedMs: number }>;
  directories: string[];
};

function allEntries(finder: FileFinderApi): IndexedEntries {
  const files: IndexedEntries["files"] = [];
  const directories: string[] = [];
  for (let pageIndex = 0; ; pageIndex += 1) {
    const page = unwrap(
      finder.mixedSearch("", { pageIndex, pageSize: PAGE_SIZE }),
      "FFF index query failed",
    );
    for (const entry of page.items) {
      if (entry.type === "file") {
        const rel = normalizeFffRel(entry.item.relativePath);
        if (rel.endsWith(".md") && isAcceptedVaultRel(rel)) {
          files.push({ rel, modifiedMs: entry.item.modified * 1_000 });
        }
      } else {
        const rel = normalizeFffRel(entry.item.relativePath).replace(/\/$/, "");
        if (rel && isAcceptedVaultRel(rel)) directories.push(rel);
      }
    }
    if ((pageIndex + 1) * PAGE_SIZE >= page.totalMatched) break;
  }
  return { files, directories };
}

function projectTree(entries: IndexedEntries): TreeNode[] {
  const root: TreeNode[] = [];
  const children = new Map<string, TreeNode[]>([["", root]]);
  const directories = new Set(entries.directories);
  for (const file of entries.files) {
    const parts = file.rel.split("/");
    for (let index = 1; index < parts.length; index += 1) {
      directories.add(parts.slice(0, index).join("/"));
    }
  }

  for (const rel of [...directories].sort(pathDepthThenName)) {
    const parent = parentRel(rel);
    const node: TreeNode = {
      name: basename(rel),
      rel,
      kind: "folder",
      children: [],
      modifiedMs: 0,
    };
    const parentChildren = children.get(parent);
    if (!parentChildren) continue;
    parentChildren.push(node);
    children.set(rel, node.children!);
  }
  for (const file of entries.files) {
    children.get(parentRel(file.rel))?.push({
      name: basename(file.rel),
      rel: file.rel,
      kind: "note",
      modifiedMs: file.modifiedMs,
    });
  }
  sortTree(root);
  return root;
}

function sortTree(nodes: TreeNode[]): void {
  nodes.sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === "folder" ? -1 : 1;
    return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
  });
  for (const node of nodes) {
    if (node.children) sortTree(node.children);
  }
}

function normalizeChange(root: string): (event: WatchEvent) => VaultChange | null {
  return (event) => {
    const rel = normalizeFffRel(relative(root, event.path));
    if (
      event.kind === "rescan" ||
      !rel.endsWith(".md") ||
      !isAcceptedVaultRel(rel)
    ) {
      return null;
    }
    return { kind: event.kind, rel };
  };
}

function normalizeFffRel(rel: string): string {
  return rel.split(sep).join("/");
}

function parentRel(rel: string): string {
  const offset = rel.lastIndexOf("/");
  return offset === -1 ? "" : rel.slice(0, offset);
}

function pathDepthThenName(left: string, right: string): number {
  const depth = left.split("/").length - right.split("/").length;
  return depth || left.localeCompare(right, undefined, { sensitivity: "base" });
}

function unwrap<T>(
  result: { ok: true; value: T } | { ok: false; error: string },
  context: string,
): T {
  if (result.ok) return result.value;
  throw new Error(`${context}: ${result.error}`);
}
