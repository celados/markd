import { afterEach, describe, expect, test } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { MARKD_IGNORE_BLOCK } from "../electron/managed-ignore";
import { VaultIndex, type VaultIndexEvent } from "../electron/vault-index";
import type { TreeNode } from "../src/lib/types";

const execFileAsync = promisify(execFile);
const scratchPaths: string[] = [];
const indexes: VaultIndex[] = [];

afterEach(async () => {
  for (const index of indexes.splice(0)) index.destroy();
  await Promise.all(
    scratchPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("fff-backed Vault Index", () => {
  test("combines Vault ignore layers and enforces the hard policy", async () => {
    const scratch = await createScratch();
    const root = join(scratch, "vault");
    const globalIgnore = join(scratch, "global-ignore");
    const globalConfig = join(scratch, "gitconfig");
    await mkdir(join(root, "projects"), { recursive: true });
    await execFileAsync("git", ["init", "--quiet", root]);
    await mkdir(join(root, ".git", "info"), { recursive: true });
    await writeFile(globalIgnore, "global.md\n");
    await writeFile(globalConfig, `[core]\n\texcludesFile = ${globalIgnore}\n`);
    await writeFile(join(root, ".git", "info", "exclude"), "info.md\n");
    await writeFile(
      join(root, ".gitignore"),
      "root.md\nprojects/*.md\n!projects/keep.md\n!node_modules/package/leak.md\n",
    );
    await writeFile(join(root, "projects", ".gitignore"), "nested.md\n");
    await writeFile(join(root, "projects", ".ignore"), "local.md\n");
    await writeFile(join(root, ".ignore"), "user.md\n!node_modules/package/leak.md\n");
    for (const rel of [
      "Visible.md",
      "global.md",
      "info.md",
      "root.md",
      "user.md",
      "projects/keep.md",
      "projects/drop.md",
      "projects/nested.md",
      "projects/local.md",
      ".hidden.md",
      "AGENTS.md",
      "dist/output.md",
      "node_modules/package/leak.md",
    ]) {
      await mkdir(join(root, rel, ".."), { recursive: true });
      await writeFile(join(root, rel), rel);
    }

    const previousConfig = process.env.GIT_CONFIG_GLOBAL;
    process.env.GIT_CONFIG_GLOBAL = globalConfig;
    try {
      const index = await VaultIndex.open(root, "system");
      indexes.push(index);
      expect(await flatten(index.snapshot().then((snapshot) => snapshot.tree))).toEqual([
        "projects/",
        "projects/keep.md",
        "global.md",
        "info.md",
        "Visible.md",
      ]);
    } finally {
      if (previousConfig === undefined) delete process.env.GIT_CONFIG_GLOBAL;
      else process.env.GIT_CONFIG_GLOBAL = previousConfig;
    }

    expect(await readFile(join(root, ".ignore"), "utf8")).toBe(
      `user.md\n!node_modules/package/leak.md\n${MARKD_IGNORE_BLOCK}\n`,
    );
  });

  test.fails("applies Git global and info excludes before indexing", async () => {
    const scratch = await createScratch();
    const root = join(scratch, "vault");
    const globalIgnore = join(scratch, "global-ignore");
    const globalConfig = join(scratch, "gitconfig");
    await mkdir(root);
    await execFileAsync("git", ["init", "--quiet", root]);
    await mkdir(join(root, ".git", "info"), { recursive: true });
    await writeFile(globalIgnore, "global.md\n");
    await writeFile(globalConfig, `[core]\n\texcludesFile = ${globalIgnore}\n`);
    await writeFile(join(root, ".git", "info", "exclude"), "info.md\n");
    await writeFile(join(root, "global.md"), "global");
    await writeFile(join(root, "info.md"), "info");

    const previousConfig = process.env.GIT_CONFIG_GLOBAL;
    process.env.GIT_CONFIG_GLOBAL = globalConfig;
    try {
      const index = await VaultIndex.open(root, "system");
      indexes.push(index);
      expect(await flatten(index.snapshot().then((snapshot) => snapshot.tree))).toEqual([]);
    } finally {
      if (previousConfig === undefined) delete process.env.GIT_CONFIG_GLOBAL;
      else process.env.GIT_CONFIG_GLOBAL = previousConfig;
    }
  });

  test.fails("preserves directory re-inclusion across nested negation", async () => {
    const scratch = await createScratch();
    const root = join(scratch, "vault");
    await mkdir(join(root, ".git"), { recursive: true });
    await mkdir(join(root, "sub1", "sub2"), { recursive: true });
    await writeFile(join(root, ".gitignore"), "*\n!*.*\n!/**/\n");
    await writeFile(join(root, "top.md"), "top");
    await writeFile(join(root, "sub1", "mid.md"), "mid");
    await writeFile(join(root, "sub1", "sub2", "deep.md"), "deep");

    const index = await VaultIndex.open(root, "system");
    indexes.push(index);
    expect(await flatten(index.snapshot().then((snapshot) => snapshot.tree))).toEqual([
      "sub1/",
      "sub1/sub2/",
      "sub1/sub2/deep.md",
      "sub1/mid.md",
      "top.md",
    ]);
  });

  test("emits changes and an epoch-replacing snapshot after ignore drift", async () => {
    const scratch = await createScratch();
    const root = join(scratch, "vault");
    await mkdir(root);
    await writeFile(join(root, "Initial.md"), "initial");
    const events: VaultIndexEvent[] = [];
    const index = await VaultIndex.open(root, "system", (event) => events.push(event));
    indexes.push(index);
    expect(events).toEqual([
      expect.objectContaining({ kind: "replacement", indexEpoch: 1, sequence: 0 }),
    ]);

    await writeFile(join(root, "External.md"), "external");
    await waitUntil(() => events.some(
      (event) => event.kind === "changes" &&
        event.changes.some((change) => change.rel === "External.md"),
    ));

    const previousReplacementEpoch = Math.max(...events
      .filter((event) => event.kind === "replacement")
      .map((event) => event.indexEpoch));
    await writeFile(join(root, "Later.md"), "later");
    await writeFile(join(root, ".ignore"), "Later.md\n");
    await waitUntil(() => events.some(
      (event) => event.kind === "replacement" &&
        event.indexEpoch > previousReplacementEpoch,
    ));
    const snapshot = await index.snapshot();
    expect(await flatten(Promise.resolve(snapshot.tree))).toEqual([
      "External.md",
      "Initial.md",
    ]);
    expect(await readFile(join(root, ".ignore"), "utf8")).toBe(
      `Later.md\n${MARKD_IGNORE_BLOCK}\n`,
    );
  });

  test("fails explicitly when the managed markers are corrupt", async () => {
    const scratch = await createScratch();
    const root = join(scratch, "vault");
    await mkdir(root);
    await writeFile(join(root, ".ignore"), "# BEGIN MARKD MANAGED IGNORE\n");

    await expect(VaultIndex.open(root, "system")).rejects.toThrowError(
      /managed ignore markers/i,
    );
  });
});

async function createScratch(): Promise<string> {
  const scratch = await mkdtemp(join(tmpdir(), "markd-vault-index-"));
  scratchPaths.push(scratch);
  return scratch;
}

async function flatten(treePromise: Promise<TreeNode[]>): Promise<string[]> {
  const tree = await treePromise;
  const paths: string[] = [];
  const visit = (nodes: TreeNode[]) => {
    for (const node of nodes) {
      paths.push(node.kind === "folder" ? `${node.rel}/` : node.rel);
      if (node.children) visit(node.children);
    }
  };
  visit(tree);
  return paths;
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for Vault Index event.");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
