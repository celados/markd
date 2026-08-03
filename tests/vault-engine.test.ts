import { afterEach, describe, expect, test } from "vitest";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { VaultEngine } from "../electron/vault-engine";

const scratchPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    scratchPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("Vault Engine path policy", () => {
  test("rejects node_modules at every direct CRUD boundary", async () => {
    const { engine, root } = await setupEngine();
    await mkdir(join(root, "notes", "node_modules"), { recursive: true });
    await writeFile(join(root, "notes", "node_modules", "Invisible.md"), "hidden");

    await expect(engine.readNote("notes/node_modules/Invisible.md")).rejects.toEqual(
      expect.objectContaining({ kind: "INVALID_PATH" }),
    );
  });

  test("rejects symlinked leaves and ancestors even when they stay inside the Vault", async () => {
    const trashCalls: string[] = [];
    const { engine, root } = await setupEngine(trashCalls);
    await mkdir(join(root, "Real"));
    await writeFile(join(root, "Real", "Inside.md"), "inside");
    await symlink("Real/Inside.md", join(root, "Alias.md"));
    await symlink("Real", join(root, "AliasFolder"));

    await expect(engine.readNote("Alias.md")).rejects.toEqual(
      expect.objectContaining({ kind: "INVALID_PATH" }),
    );
    await expect(engine.readNote("AliasFolder/Inside.md")).rejects.toEqual(
      expect.objectContaining({ kind: "INVALID_PATH" }),
    );
    await expect(engine.moveToTrash("Alias.md")).rejects.toEqual(
      expect.objectContaining({ kind: "INVALID_PATH" }),
    );
    expect(trashCalls).toEqual([]);
  });

  test("rejects a symlink that escapes the Vault", async () => {
    const { engine, root, scratch } = await setupEngine();
    const outside = join(scratch, "Outside.md");
    await writeFile(outside, "outside");
    await symlink(outside, join(root, "Escape.md"));

    await expect(engine.readNote("Escape.md")).rejects.toEqual(
      expect.objectContaining({ kind: "INVALID_PATH" }),
    );
  });
});

async function setupEngine(trashCalls: string[] = []) {
  const scratch = await mkdtemp(join(tmpdir(), "markd-vault-engine-"));
  scratchPaths.push(scratch);
  const root = join(scratch, "vault");
  const config = join(scratch, "config");
  await mkdir(root);
  const engine = new VaultEngine(config, async (_vaultRoot, path) => {
    trashCalls.push(path);
  });
  await engine.open(root, false);
  return { engine, root, scratch };
}
