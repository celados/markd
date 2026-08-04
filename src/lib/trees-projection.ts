import type { FileTreeBatchOperation } from "@pierre/trees";
import type { TreeNode } from "./types";

export type TreesProjection = {
  paths: readonly string[];
  byRel: ReadonlyMap<string, TreeNode>;
};

export type ExternalTreesReconcile =
  | { kind: "unchanged" }
  | { kind: "batch"; operations: FileTreeBatchOperation[] };

export function createTreesProjection(
  tree: readonly TreeNode[],
  hiddenRoots: ReadonlySet<string> = new Set<string>(),
): TreesProjection {
  const paths: string[] = [];
  const byRel = new Map<string, TreeNode>();

  const visit = (nodes: readonly TreeNode[]) => {
    for (const node of nodes) {
      if (hiddenRoots.has(node.rel)) continue;
      byRel.set(node.rel, node);
      // Trees uses a trailing slash only as its directory type marker. Riffle's
      // Vault-relative path remains the identity on both sides of this seam.
      paths.push(toTreesPath(node));
      if (node.children) visit(node.children);
    }
  };
  visit(tree);

  return { paths, byRel };
}

export function diffTreesProjection(
  previous: TreesProjection,
  next: TreesProjection,
): FileTreeBatchOperation[] {
  const previousPaths = new Set(previous.paths);
  const nextPaths = new Set(next.paths);
  const operations: FileTreeBatchOperation[] = [];

  for (const path of previous.paths) {
    if (nextPaths.has(path) || hasRemovedAncestor(path, nextPaths, previousPaths)) continue;
    operations.push({
      type: "remove",
      path,
      ...(path.endsWith("/") ? { recursive: true } : {}),
    });
  }
  for (const path of next.paths) {
    if (!previousPaths.has(path)) operations.push({ type: "add", path });
  }
  return operations;
}

export function planExternalTreesReconcile(
  previous: TreesProjection,
  next: TreesProjection,
): ExternalTreesReconcile {
  const operations = diffTreesProjection(previous, next);
  return operations.length === 0
    ? { kind: "unchanged" }
    : { kind: "batch", operations };
}

export function applyExternalTreesReconcile(
  target: Pick<{ batch(operations: readonly FileTreeBatchOperation[]): void }, "batch">,
  previous: TreesProjection,
  next: TreesProjection,
): ExternalTreesReconcile {
  const reconcile = planExternalTreesReconcile(previous, next);
  if (reconcile.kind === "batch") target.batch(reconcile.operations);
  return reconcile;
}

export function fromTreesPath(path: string): string {
  return path.endsWith("/") ? path.slice(0, -1) : path;
}

function toTreesPath(node: TreeNode): string {
  return node.kind === "folder" ? `${node.rel}/` : node.rel;
}

function hasRemovedAncestor(
  path: string,
  nextPaths: ReadonlySet<string>,
  previousPaths: ReadonlySet<string>,
): boolean {
  const rel = fromTreesPath(path);
  const parts = rel.split("/");
  for (let index = 1; index < parts.length; index += 1) {
    const ancestor = `${parts.slice(0, index).join("/")}/`;
    if (previousPaths.has(ancestor) && !nextPaths.has(ancestor)) return true;
  }
  return false;
}
