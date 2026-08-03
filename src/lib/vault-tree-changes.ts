import type { VaultChange, VaultIndexEntry } from "./desktop";
import type { TreeNode } from "./types";

export function applyVaultChanges(tree: TreeNode[], changes: VaultChange[]): TreeNode[] {
  const entries = new Map<string, VaultIndexEntry>();
  flatten(tree, entries);
  for (const change of changes) {
    if (change.kind === "removed") {
      const prefix = `${change.rel}/`;
      for (const rel of entries.keys()) {
        if (rel === change.rel || rel.startsWith(prefix)) entries.delete(rel);
      }
      continue;
    }
    entries.set(change.entry.rel, change.entry);
    ensureParents(entries, change.entry.rel);
  }
  return project(entries.values());
}

export function diffVaultTrees(before: TreeNode[], after: TreeNode[]): VaultChange[] {
  const previous = new Map<string, VaultIndexEntry>();
  const next = new Map<string, VaultIndexEntry>();
  flatten(before, previous);
  flatten(after, next);
  const changes: VaultChange[] = [];
  for (const [rel, entry] of previous) {
    const replacement = next.get(rel);
    if (!replacement || replacement.kind !== entry.kind) {
      changes.push({ kind: "removed", rel });
    }
  }
  for (const [rel, entry] of next) {
    const current = previous.get(rel);
    if (!current || current.kind !== entry.kind) {
      changes.push({ kind: "created", entry });
    } else if (entry.kind === "note" && entry.modifiedMs !== current.modifiedMs) {
      changes.push({ kind: "modified", entry });
    }
  }
  return changes;
}

function flatten(nodes: TreeNode[], entries: Map<string, VaultIndexEntry>): void {
  for (const node of nodes) {
    entries.set(node.rel, {
      rel: node.rel,
      kind: node.kind,
      modifiedMs: node.modifiedMs,
    });
    if (node.children) flatten(node.children, entries);
  }
}

function ensureParents(entries: Map<string, VaultIndexEntry>, rel: string): void {
  const parts = rel.split("/");
  for (let index = 1; index < parts.length; index += 1) {
    const parent = parts.slice(0, index).join("/");
    if (!entries.has(parent)) {
      entries.set(parent, { rel: parent, kind: "folder", modifiedMs: 0 });
    }
  }
}

function project(entries: Iterable<VaultIndexEntry>): TreeNode[] {
  const root: TreeNode[] = [];
  const children = new Map<string, TreeNode[]>([["", root]]);
  const ordered = [...entries].sort((left, right) => {
    const depth = left.rel.split("/").length - right.rel.split("/").length;
    return depth || left.rel.localeCompare(right.rel, undefined, { sensitivity: "base" });
  });
  for (const entry of ordered.filter((value) => value.kind === "folder")) {
    const node: TreeNode = {
      name: fileName(entry.rel),
      rel: entry.rel,
      kind: "folder",
      children: [],
      modifiedMs: 0,
    };
    const parentChildren = children.get(parentRel(entry.rel));
    if (!parentChildren) continue;
    parentChildren.push(node);
    children.set(entry.rel, node.children!);
  }
  for (const entry of ordered.filter((value) => value.kind === "note")) {
    children.get(parentRel(entry.rel))?.push({
      name: fileName(entry.rel),
      rel: entry.rel,
      kind: "note",
      modifiedMs: entry.modifiedMs,
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
  for (const node of nodes) if (node.children) sortTree(node.children);
}

function parentRel(rel: string): string {
  const offset = rel.lastIndexOf("/");
  return offset === -1 ? "" : rel.slice(0, offset);
}

function fileName(rel: string): string {
  return rel.slice(rel.lastIndexOf("/") + 1);
}
