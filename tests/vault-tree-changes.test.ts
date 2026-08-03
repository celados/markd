import { describe, expect, test } from "vitest";
import { applyVaultChanges, diffVaultTrees } from "../src/lib/vault-tree-changes";
import type { TreeNode } from "../src/lib/types";

describe("incremental Vault tree projection", () => {
  test("creates parents, updates notes, and removes subtrees", () => {
    const initial: TreeNode[] = [{
      name: "Before.md",
      rel: "Before.md",
      kind: "note",
      modifiedMs: 1,
    }];
    const created = applyVaultChanges(initial, [{
      kind: "created",
      entry: { rel: "Folder/Note.md", kind: "note", modifiedMs: 2 },
    }]);
    expect(created).toEqual([
      expect.objectContaining({
        rel: "Folder",
        children: [expect.objectContaining({ rel: "Folder/Note.md", modifiedMs: 2 })],
      }),
      expect.objectContaining({ rel: "Before.md" }),
    ]);

    const updated = applyVaultChanges(created, [{
      kind: "modified",
      entry: { rel: "Folder/Note.md", kind: "note", modifiedMs: 3 },
    }]);
    expect(updated[0]?.children?.[0]?.modifiedMs).toBe(3);
    expect(applyVaultChanges(updated, [{ kind: "removed", rel: "Folder" }])).toEqual([
      expect.objectContaining({ rel: "Before.md" }),
    ]);
  });

  test("diffs replacement snapshots into affected Note changes", () => {
    const before: TreeNode[] = [
      { name: "Gone.md", rel: "Gone.md", kind: "note", modifiedMs: 1 },
      { name: "Edited.md", rel: "Edited.md", kind: "note", modifiedMs: 1 },
    ];
    const after: TreeNode[] = [
      { name: "Edited.md", rel: "Edited.md", kind: "note", modifiedMs: 2 },
      { name: "New.md", rel: "New.md", kind: "note", modifiedMs: 3 },
    ];

    expect(diffVaultTrees(before, after)).toEqual([
      { kind: "removed", rel: "Gone.md" },
      {
        kind: "modified",
        entry: { rel: "Edited.md", kind: "note", modifiedMs: 2 },
      },
      {
        kind: "created",
        entry: { rel: "New.md", kind: "note", modifiedMs: 3 },
      },
    ]);
  });
});
