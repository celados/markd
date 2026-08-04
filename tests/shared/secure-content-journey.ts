import { expect, type ElectronApplication } from "@playwright/test";
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

type LaunchSecureContentApp = (configDir: string) => Promise<ElectronApplication>;

export async function runSecureContentJourney(launch: LaunchSecureContentApp): Promise<void> {
  const scratch = await mkdtemp(join(tmpdir(), "riffle-electron-content-"));
  const configDir = join(scratch, "config");
  const vault = join(scratch, "vault");
  const noteExport = join(scratch, "Draft export.md");
  const bookmarkExport = join(scratch, "Bookmarks export.md");
  await mkdir(configDir, { recursive: true });
  await mkdir(vault, { recursive: true });
  await writeFile(join(vault, "Draft.md"), "stale disk body");
  await writeFile(
    join(configDir, "config.json"),
    JSON.stringify({ vaultPath: vault, theme: "system" }),
  );

  let application: ElectronApplication | null = null;
  try {
    application = await launch(configDir);
    const page = await application.firstWindow();
    await expect.poll(() => page.evaluate(() => window.riffle!.vault.startup())).toEqual({
      ok: true,
      value: expect.objectContaining({ root: await realpath(vault) }),
    });

    const png =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
    const saved = await page.evaluate((data) => window.riffle!.vault.assets.save(data, "png"), png);
    expect(saved).toEqual({ ok: true, value: expect.stringMatching(/^\.markd\/assets\//) });
    if (!saved.ok) throw new Error(saved.error.message);
    expect(await readFile(join(vault, saved.value))).toEqual(
      Buffer.from(png.slice(png.indexOf(",") + 1), "base64"),
    );
    expect(await page.evaluate(async (rel) => {
      const url = window.riffle!.vault.assets.url(rel);
      if (!url) return null;
      const response = await fetch(url);
      const image = new Image();
      const loaded = new Promise<boolean>((resolve) => {
        image.onload = () => resolve(true);
        image.onerror = () => resolve(false);
      });
      image.src = url;
      document.body.append(image);
      return {
        status: response.status,
        type: response.headers.get("content-type"),
        size: (await response.arrayBuffer()).byteLength,
        loaded: await loaded,
      };
    }, saved.value)).toEqual({ status: 200, type: "image/png", size: 68, loaded: true });

    await application.evaluate(({ dialog }, paths) => {
      const destinations = [...paths];
      dialog.showSaveDialog = async () => ({
        canceled: false,
        filePath: destinations.shift(),
      });
    }, [noteExport, bookmarkExport]);
    expect(await page.evaluate(() =>
      window.riffle!.vault.exportNote("Draft.md", "live editor body"),
    )).toEqual({ ok: true, value: join(await realpath(scratch), "Draft export.md") });
    expect(await readFile(noteExport, "utf8")).toBe("live editor body");

    await page.evaluate(() => window.riffle!.collections.bookmarks.create("example.com", ["read"]));
    expect(await page.evaluate(() => window.riffle!.collections.bookmarks.export())).toEqual({
      ok: true,
      value: join(await realpath(scratch), "Bookmarks export.md"),
    });
    expect(await readFile(bookmarkExport, "utf8")).toContain(
      "- [example.com](https://example.com) — #read",
    );

    const outside = join(scratch, "outside.png");
    const escape = join(vault, ".markd", "assets", "escape.png");
    await writeFile(outside, "outside");
    await symlink(outside, escape);
    expect(await page.evaluate(() => ({
      traversalUrl: window.riffle!.vault.assets.url("../outside.png"),
      symlinkUrl: window.riffle!.vault.assets.url(".markd/assets/escape.png"),
    }))).toEqual({ traversalUrl: null, symlinkUrl: "riffle-asset://vault/escape.png" });
    expect(await page.evaluate(async () =>
      fetch("riffle-asset://vault/..%2Foutside.png").then((response) => response.status),
    )).toBe(400);
    expect(await page.evaluate(async () =>
      fetch("riffle-asset://vault/escape.png").then((response) => response.status),
    )).toBe(400);

    const outsideExport = join(scratch, "outside.md");
    const exportAlias = join(scratch, "export-alias.md");
    await writeFile(outsideExport, "keep");
    await symlink(outsideExport, exportAlias);
    await application.evaluate(({ dialog }, path) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
    }, exportAlias);
    expect(await page.evaluate(() =>
      window.riffle!.vault.exportNote("Draft.md", "overwrite"),
    )).toEqual({
      ok: false,
      error: expect.objectContaining({ kind: "INVALID_PATH" }),
    });
    expect(await readFile(outsideExport, "utf8")).toBe("keep");
  } finally {
    await application?.close();
    await rm(scratch, { recursive: true, force: true });
  }
}
