import { afterEach, describe, expect, test } from "vitest";
import {
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
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

describe("Vault Engine Pins", () => {
  test("persists valid note and folder Pins without duplicating descendants", async () => {
    const { engine, root } = await setupEngine();
    await mkdir(join(root, "Projects"));
    await writeFile(join(root, "Root.md"), "root");
    await writeFile(join(root, "Projects", "Plan.md"), "plan");

    expect(await engine.pin("Projects/Plan.md")).toEqual({
      pins: ["Projects/Plan.md"],
      stale: [],
    });
    expect(await engine.pin("Projects")).toEqual({
      pins: ["Projects"],
      stale: [],
    });
    expect(await engine.pin("Projects/Plan.md")).toEqual({
      pins: ["Projects"],
      stale: [],
    });
    expect(JSON.parse(await readFile(join(root, ".markd", "pins.json"), "utf8")))
      .toEqual(["Projects"]);
  });

  test("reports externally removed Pin targets as stale until explicitly unpinned", async () => {
    const { engine, root } = await setupEngine();
    await writeFile(join(root, "Missing.md"), "soon gone");
    await engine.pin("Missing.md");
    await rm(join(root, "Missing.md"));

    expect(await engine.listPins()).toEqual({ pins: [], stale: ["Missing.md"] });
    expect(await engine.unpin("Missing.md")).toEqual({ pins: [], stale: [] });
  });

  test("rejects Pin requests for missing and non-Markdown targets", async () => {
    const { engine, root } = await setupEngine();
    await writeFile(join(root, "Attachment.txt"), "attachment");
    await writeFile(join(root, "Invisible.MD"), "not in the Note tree");

    await expect(engine.pin("Missing.md")).rejects.toEqual(
      expect.objectContaining({ kind: "NOT_FOUND" }),
    );
    await expect(engine.pin("Attachment.txt")).rejects.toEqual(
      expect.objectContaining({ kind: "INVALID_PATH" }),
    );
    await expect(engine.pin("Invisible.MD")).rejects.toEqual(
      expect.objectContaining({ kind: "INVALID_PATH" }),
    );
    await expect(engine.pin("")).rejects.toEqual(
      expect.objectContaining({ kind: "INVALID_PATH" }),
    );
    expect(await engine.listPins()).toEqual({ pins: [], stale: [] });
  });

  test("removes Pins beneath an entry after native Trash succeeds", async () => {
    const scratch = await mkdtemp(join(tmpdir(), "markd-vault-trash-"));
    scratchPaths.push(scratch);
    const root = join(scratch, "vault");
    await mkdir(root);
    const engine = new VaultEngine(join(scratch, "config"), async (_root, path) => {
      await rm(path, { recursive: true });
    });
    await engine.open(root, false);
    await mkdir(join(root, "Projects"));
    await writeFile(join(root, "Projects", "Plan.md"), "plan");
    await engine.pin("Projects");

    await engine.moveToTrash("Projects");

    expect(await engine.listPins()).toEqual({ pins: [], stale: [] });
  });

  test("resolves the canonical full path from a symlinked Vault root", async () => {
    const scratch = await mkdtemp(join(tmpdir(), "markd-vault-alias-"));
    scratchPaths.push(scratch);
    const root = join(scratch, "real-vault");
    const alias = join(scratch, "vault-alias");
    await mkdir(root);
    await writeFile(join(root, "Note.md"), "note");
    await symlink(root, alias);
    const engine = new VaultEngine(join(scratch, "config"), async () => {});
    await engine.open(alias, false);

    expect(await engine.resolveNotePath("Note.md")).toBe(
      join(await realpath(root), "Note.md"),
    );
  });
});

describe("Vault Engine Quick Capture", () => {
  test("creates a Note and appends Markdown with one line boundary", async () => {
    const { engine, root } = await setupEngine();

    const created = await engine.captureCreate("Inbox", "first thought");
    expect(created.rel).toBe("Inbox.md");
    expect(await readFile(join(root, created.rel), "utf8")).toBe("first thought");

    const appended = await engine.captureAppend(created.rel, "second thought");
    expect(appended.rel).toBe("Inbox.md");
    expect(await readFile(join(root, created.rel), "utf8")).toBe(
      "first thought\nsecond thought",
    );
  });

  test("rejects append without an active Vault or a non-Note target", async () => {
    const scratch = await mkdtemp(join(tmpdir(), "markd-capture-unavailable-"));
    scratchPaths.push(scratch);
    const engine = new VaultEngine(join(scratch, "config"), async () => {});

    await expect(engine.captureAppend("Inbox.md", "thought")).rejects.toEqual(
      expect.objectContaining({ kind: "NO_ACTIVE_VAULT" }),
    );
  });

  test("merges a semantic append into an editor write based on the prior content", async () => {
    const { engine, root } = await setupEngine();
    await engine.captureCreate("Inbox", "base");
    await engine.captureAppend("Inbox.md", "captured");

    await expect(
      engine.writeNote("Inbox.md", "edited", "base"),
    ).resolves.toBe("edited\ncaptured");
    expect(await readFile(join(root, "Inbox.md"), "utf8")).toBe(
      "edited\ncaptured",
    );
  });

  test("rejects a stale editor write after a non-append external change", async () => {
    const { engine, root } = await setupEngine();
    await engine.captureCreate("Inbox", "base");
    await writeFile(join(root, "Inbox.md"), "rewritten elsewhere");

    await expect(
      engine.writeNote("Inbox.md", "edited", "base"),
    ).rejects.toEqual(expect.objectContaining({ kind: "STALE_NOTE_WRITE" }));
    expect(await readFile(join(root, "Inbox.md"), "utf8")).toBe(
      "rewritten elsewhere",
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
