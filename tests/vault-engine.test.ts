import { afterEach, describe, expect, test } from "vitest";
import {
  appendFile,
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { VaultEngine } from "../electron/vault-engine";

const scratchPaths: string[] = [];
const engines: VaultEngine[] = [];

afterEach(async () => {
  for (const engine of engines.splice(0)) engine.destroy();
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

  test.each([".secret", "AGENTS", "CLAUDE"])(
    "rejects hard-policy title %s before creating a file",
    async (title) => {
      const { engine, root } = await setupEngine();

      await expect(engine.createNote("", title, "content")).rejects.toEqual(
        expect.objectContaining({ kind: "INVALID_PATH" }),
      );
      await expect(readFile(join(root, `${title}.md`), "utf8")).rejects.toEqual(
        expect.objectContaining({ code: "ENOENT" }),
      );
    },
  );

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

  test("rejects an ignored Note before creating a file", async () => {
    const { engine, root } = await setupEngine([], async (vaultRoot) => {
      await writeFile(join(vaultRoot, ".gitignore"), "Ignored.md\n");
    });

    await expect(engine.createNote("", "Ignored", "draft")).rejects.toEqual(
      expect.objectContaining({ kind: "IGNORED_PATH" }),
    );
    await expect(readFile(join(root, "Ignored.md"), "utf8")).rejects.toEqual(
      expect.objectContaining({ code: "ENOENT" }),
    );
  });

});

describe("Vault Engine search and backlinks", () => {
  test("ranks path hits first and validates backlink candidates as Markdown", async () => {
    const { engine } = await setupEngine([], async (root) => {
      await mkdir(join(root, "Projects"));
      await writeFile(join(root, "Projects", "Alpha.md"), "Alpha also appears here.");
      await writeFile(join(root, "README.md"), "Alpha appears only in content.");
      await writeFile(join(root, ".gitignore"), "Ignored.md\n");
      await writeFile(join(root, "Ignored.md"), "Alpha must not escape the index.");
      await writeFile(join(root, "Target.md"), "# Target");
      await writeFile(
        join(root, "Source.md"),
        [
          "Plain Target.md text is not a backlink.",
          "![preview](Target.md)",
          "```md",
          "[example](Target.md)",
          "```",
          "A real [target](Target.md#details).",
        ].join("\n"),
      );
    });

    const hits = await engine.searchNotes("alpha", 10);
    expect(hits.map((hit) => hit.rel)).toEqual([
      "Projects/Alpha.md",
      "README.md",
    ]);
    expect(hits[0]).toEqual(expect.objectContaining({ titleMatch: true }));
    expect(hits[1]).toEqual(expect.objectContaining({ titleMatch: false }));

    expect(await engine.backlinksFor("Target.md")).toEqual([
      {
        sourceRel: "Source.md",
        context: "A real target.",
        line: 6,
        occurrence: 0,
      },
    ]);
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
    const engine = new VaultEngine(join(scratch, "config"), {
      moveToTrash: async (_root, path) => rm(path, { recursive: true }),
      stageAssetRoot: async () => "stage",
      commitAssetRoot: async () => undefined,
      rollbackAssetRoot: async () => undefined,
      saveExport: async () => null,
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
    const engine = new VaultEngine(join(scratch, "config"), {
      moveToTrash: async () => undefined,
      stageAssetRoot: async () => "stage",
      commitAssetRoot: async () => undefined,
      rollbackAssetRoot: async () => undefined,
      saveExport: async () => null,
    });
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

  test("rejects blank append content at the Engine boundary", async () => {
    const { engine } = await setupEngine();
    await engine.captureCreate("Inbox", "base");

    await expect(engine.captureAppend("Inbox.md", " \n ")).rejects.toEqual(
      expect.objectContaining({ kind: "INVALID_CAPTURE" }),
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

  test("merges consecutive capture appends with their exact newline boundaries", async () => {
    const { engine, root } = await setupEngine();
    await engine.captureCreate("Inbox", "base\n");
    await engine.captureAppend("Inbox.md", "first capture");
    await engine.captureAppend("Inbox.md", "second capture");

    await expect(
      engine.writeNote("Inbox.md", "edited\n", "base\n"),
    ).resolves.toBe("edited\nfirst capture\nsecond capture");
    expect(await readFile(join(root, "Inbox.md"), "utf8")).toBe(
      "edited\nfirst capture\nsecond capture",
    );
  });

  test("replays only captures after an editor-observed checkpoint", async () => {
    const { engine, root } = await setupEngine();
    await engine.captureCreate("Inbox", "base");
    await engine.captureAppend("Inbox.md", "first capture");
    await engine.captureAppend("Inbox.md", "second capture");

    await expect(
      engine.writeNote(
        "Inbox.md",
        "edited\nfirst capture",
        "base\nfirst capture",
      ),
    ).resolves.toBe("edited\nfirst capture\nsecond capture");
    expect(await readFile(join(root, "Inbox.md"), "utf8")).toBe(
      "edited\nfirst capture\nsecond capture",
    );
  });

  test("merges a proven capture from an empty Note", async () => {
    const { engine, root } = await setupEngine();
    await engine.captureCreate("Inbox", "");
    await engine.captureAppend("Inbox.md", "captured");

    await expect(engine.writeNote("Inbox.md", "edited", "")).resolves.toBe(
      "edited\ncaptured",
    );
    expect(await readFile(join(root, "Inbox.md"), "utf8")).toBe(
      "edited\ncaptured",
    );
  });

  test("rejects ordinary prefix appends, including from an empty expected value", async () => {
    const { engine, root } = await setupEngine();
    await engine.captureCreate("Inbox", "base");
    await appendFile(join(root, "Inbox.md"), "\nexternal append");
    await expect(
      engine.writeNote("Inbox.md", "edited", "base"),
    ).rejects.toEqual(expect.objectContaining({ kind: "STALE_NOTE_WRITE" }));

    await engine.captureCreate("Empty", "");
    await writeFile(join(root, "Empty.md"), "external content");
    await expect(
      engine.writeNote("Empty.md", "edited", ""),
    ).rejects.toEqual(expect.objectContaining({ kind: "STALE_NOTE_WRITE" }));
  });

  test("rejects a capture merge after a later external edit", async () => {
    const { engine, root } = await setupEngine();
    await engine.captureCreate("Inbox", "base");
    await engine.captureAppend("Inbox.md", "captured");
    await appendFile(join(root, "Inbox.md"), "\nexternal edit");

    await expect(
      engine.writeNote("Inbox.md", "edited", "base"),
    ).rejects.toEqual(expect.objectContaining({ kind: "STALE_NOTE_WRITE" }));
    expect(await readFile(join(root, "Inbox.md"), "utf8")).toBe(
      "base\ncaptured\nexternal edit",
    );
  });

  test("rejects provenance after the captured Note is renamed and replaced", async () => {
    const { engine, root } = await setupEngine();
    await engine.captureCreate("Inbox", "base");
    await engine.captureAppend("Inbox.md", "captured");
    await rename(join(root, "Inbox.md"), join(root, "Archived.md"));
    await writeFile(join(root, "Inbox.md"), "base\ncaptured");

    await expect(
      engine.writeNote("Inbox.md", "edited", "base"),
    ).rejects.toEqual(expect.objectContaining({ kind: "STALE_NOTE_WRITE" }));
  });

  test("invalidates capture provenance after a non-capture write", async () => {
    const { engine, root } = await setupEngine();
    await engine.captureCreate("Inbox", "base");
    await engine.captureAppend("Inbox.md", "captured");
    await engine.writeNote("Inbox.md", "replacement", "base\ncaptured");

    // Recreating the old bytes must not resurrect the proof consumed above.
    await writeFile(join(root, "Inbox.md"), "base\ncaptured");
    await expect(
      engine.writeNote("Inbox.md", "edited", "base"),
    ).rejects.toEqual(expect.objectContaining({ kind: "STALE_NOTE_WRITE" }));
  });

  test("invalidates capture provenance after Trash and Vault switches", async () => {
    const { engine, root, scratch } = await setupEngine();
    await engine.captureCreate("Inbox", "base");
    await engine.captureAppend("Inbox.md", "captured");
    await engine.moveToTrash("Inbox.md");
    await writeFile(join(root, "Inbox.md"), "base\ncaptured");
    await expect(
      engine.writeNote("Inbox.md", "edited", "base"),
    ).rejects.toEqual(expect.objectContaining({ kind: "STALE_NOTE_WRITE" }));

    // A matching relative path and byte sequence in another Vault is a
    // different Note and cannot inherit append provenance from the first.
    await engine.captureAppend("Inbox.md", "new capture");
    const otherRoot = join(scratch, "other-vault");
    await mkdir(otherRoot);
    await writeFile(join(otherRoot, "Inbox.md"), "base\ncaptured\nnew capture");
    await engine.open(otherRoot, false);
    await expect(
      engine.writeNote("Inbox.md", "edited", "base\ncaptured"),
    ).rejects.toEqual(expect.objectContaining({ kind: "STALE_NOTE_WRITE" }));

    expect(await readFile(join(root, "Inbox.md"), "utf8")).toBe(
      "base\ncaptured\nnew capture",
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

async function setupEngine(
  trashCalls: string[] = [],
  beforeOpen: (root: string) => Promise<void> = async () => {},
) {
  const scratch = await mkdtemp(join(tmpdir(), "markd-vault-engine-"));
  scratchPaths.push(scratch);
  const root = join(scratch, "vault");
  const config = join(scratch, "config");
  await mkdir(root);
  await beforeOpen(root);
  const engine = new VaultEngine(config, {
    moveToTrash: async (_vaultRoot, path) => {
      trashCalls.push(path);
      await rm(path, { recursive: true });
    },
    stageAssetRoot: async () => "stage",
    commitAssetRoot: async () => undefined,
    rollbackAssetRoot: async () => undefined,
    saveExport: async () => null,
  });
  engines.push(engine);
  await engine.open(root, false);
  return { engine, root, scratch };
}
