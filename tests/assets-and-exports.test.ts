import {
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  loadAssetResponse,
  writeExportFile,
} from "../electron/native-content";
import { assetUrl } from "../electron/asset-url";
import {
  VaultEngine,
  type ExportPreparation,
} from "../electron/vault-engine";

const scratchPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    scratchPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("Vault Engine assets", () => {
  test("saves validated image data beneath the canonical asset root", async () => {
    const { engine, root, activatedRoots } = await setupEngine();

    const rel = await engine.saveAsset(
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==",
      "PNG",
    );

    expect(rel).toMatch(/^\.markd\/assets\/[0-9a-f-]+\.png$/);
    expect(await readFile(join(root, rel))).toEqual(
      Buffer.from("iVBORw0KGgoAAAANSUhEUg==", "base64"),
    );
    expect(activatedRoots).toEqual([
      { root, assetRoot: join(root, ".markd", "assets") },
    ]);
  });

  test("rejects malformed data, unsupported types, and a symlinked asset root", async () => {
    const { engine } = await setupEngine();
    await expect(engine.saveAsset("not base64!", "png")).rejects.toEqual(
      expect.objectContaining({ kind: "INVALID_INPUT" }),
    );
    await expect(engine.saveAsset("aGVsbG8=", "html")).rejects.toEqual(
      expect.objectContaining({ kind: "INVALID_INPUT" }),
    );

    const scratch = await scratchDirectory("markd-assets-symlink-");
    const root = join(scratch, "vault");
    const outside = join(scratch, "outside");
    await mkdir(join(root, ".markd"), { recursive: true });
    await mkdir(outside);
    await symlink(outside, join(root, ".markd", "assets"));
    const unsafe = new VaultEngine(join(scratch, "config"), nativeOperations());

    await expect(unsafe.open(root, false)).rejects.toEqual(
      expect.objectContaining({ kind: "INVALID_PATH" }),
    );
  });
});

describe("Vault Engine exports", () => {
  test("prepares the live Note body and current Bookmarks before native save", async () => {
    const exports: ExportPreparation[] = [];
    const { engine, root } = await setupEngine([], exports);
    await writeFile(join(root, "Draft.md"), "stale disk body");
    await engine.createBookmark("https://example.com", ["read"]);

    expect(await engine.exportNote("Draft.md", "live editor body")).toBe(
      "/exports/Draft.md",
    );
    expect(await engine.exportBookmarks()).toBe("/exports/bookmarks.md");
    expect(exports).toEqual([
      { suggestedName: "Draft.md", content: "live editor body" },
      {
        suggestedName: "bookmarks.md",
        content: "# Bookmarks\n\n- [example.com](https://example.com) — #read\n",
      },
    ]);
  });

  test("rejects traversal and missing Note sources before opening a native dialog", async () => {
    const exports: ExportPreparation[] = [];
    const { engine } = await setupEngine([], exports);

    await expect(engine.exportNote("../Outside.md", "body")).rejects.toEqual(
      expect.objectContaining({ kind: "INVALID_PATH" }),
    );
    await expect(engine.exportNote("Missing.md", "body")).rejects.toEqual(
      expect.objectContaining({ kind: "NOT_FOUND" }),
    );
    expect(exports).toEqual([]);
  });
});

describe("native content paths", () => {
  test("serves only canonical files below the active asset root", async () => {
    const scratch = await scratchDirectory("markd-protocol-");
    const assetRootPath = join(scratch, "assets");
    await mkdir(assetRootPath);
    const assetRoot = await realpath(assetRootPath);
    await writeFile(join(assetRoot, "pixel.png"), Buffer.from("png bytes"));

    const url = assetUrl(".markd/assets/pixel.png");
    const response = await loadAssetResponse(assetRoot, url);

    expect(url).toBe("markd-asset://vault/pixel.png");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(Buffer.from("png bytes"));
  });

  test("rejects traversal, unsupported files, and symlink escapes", async () => {
    const scratch = await scratchDirectory("markd-protocol-reject-");
    const assetRoot = join(scratch, "assets");
    await mkdir(assetRoot);
    await writeFile(join(scratch, "outside.png"), "outside");
    await symlink(join(scratch, "outside.png"), join(assetRoot, "escape.png"));
    await writeFile(join(assetRoot, "page.html"), "<script></script>");

    await expect(loadAssetResponse(assetRoot, "markd-asset://vault/%2Fetc/passwd"))
      .rejects.toEqual(expect.objectContaining({ kind: "INVALID_PATH" }));
    await expect(loadAssetResponse(assetRoot, "markd-asset://vault/escape.png"))
      .rejects.toEqual(expect.objectContaining({ kind: "INVALID_PATH" }));
    await expect(loadAssetResponse(assetRoot, "markd-asset://vault/page.html"))
      .rejects.toEqual(expect.objectContaining({ kind: "INVALID_PATH" }));
    expect(assetUrl("../outside.png")).toBeNull();
  });

  test("writes through a canonical destination without following a leaf symlink", async () => {
    const scratch = await scratchDirectory("markd-export-");
    const output = join(scratch, "Note.md");
    expect(await writeExportFile(output, "exported")).toBe(
      join(await realpath(scratch), "Note.md"),
    );
    expect(await readFile(output, "utf8")).toBe("exported");

    const outside = join(scratch, "outside.md");
    const alias = join(scratch, "alias.md");
    await writeFile(outside, "keep");
    await symlink(outside, alias);
    await expect(writeExportFile(alias, "overwrite")).rejects.toEqual(
      expect.objectContaining({ kind: "INVALID_PATH" }),
    );
    expect(await readFile(outside, "utf8")).toBe("keep");
  });
});

async function setupEngine(
  activatedRoots: Array<{ root: string; assetRoot: string }> = [],
  exports: ExportPreparation[] = [],
) {
  const scratch = await scratchDirectory("markd-assets-engine-");
  const root = join(scratch, "vault");
  await mkdir(root);
  const engine = new VaultEngine(
    join(scratch, "config"),
    nativeOperations(activatedRoots, exports),
  );
  const snapshot = await engine.open(root, false);
  return { engine, root: snapshot.root, activatedRoots };
}

function nativeOperations(
  activatedRoots: Array<{ root: string; assetRoot: string }> = [],
  exports: ExportPreparation[] = [],
) {
  return {
    moveToTrash: async () => undefined,
    activateAssetRoot: async (root: string, assetRoot: string) => {
      activatedRoots.push({ root, assetRoot });
    },
    saveExport: async (preparation: ExportPreparation) => {
      exports.push(preparation);
      return `/exports/${preparation.suggestedName}`;
    },
  };
}

async function scratchDirectory(prefix: string): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), prefix));
  scratchPaths.push(path);
  return path;
}
