import { afterEach, describe, expect, test } from "vitest";
import { createPackage } from "@electron/asar";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { inspectElectronPackage } from "../scripts/verify-electron-package.mjs";

const scratch: string[] = [];

afterEach(async () => {
  await Promise.all(scratch.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

test("artifact inspection fails closed when fff is absent", async () => {
  const fixture = await packageFixture(false);
  expect(() => inspectElectronPackage(fixture)).toThrow(/fff dynamic library is missing/u);
});

test("artifact inspection accepts complete Electron and native inventories", async () => {
  const fixture = await packageFixture(true);
  expect(inspectElectronPackage(fixture)).toMatchObject({
    fffLibrary: expect.stringMatching(/libfff_c\.dylib$/u),
    ffiAddon: expect.stringMatching(/\.node$/u),
  });
});

async function packageFixture(includeFff: boolean): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "markd-package-test-"));
  scratch.push(root);
  const app = join(root, "Markd.app");
  const resources = join(app, "Contents", "Resources");
  const source = join(root, "asar-source");
  for (const path of [
    "dist/index.html",
    "dist-electron/main.js",
    "dist-electron/preload.mjs",
    "dist-electron/engine.js",
    "node_modules/electron-updater/package.json",
  ]) {
    await mkdir(join(source, path, ".."), { recursive: true });
    await writeFile(join(source, path), "fixture");
  }
  await mkdir(resources, { recursive: true });
  await createPackage(source, join(resources, "app.asar"));
  await writeFile(join(resources, "app-update.yml"), "provider: github\nowner: celados\nrepo: markd\n");
  const nativeRoot = join(resources, "app.asar.unpacked", "node_modules");
  await mkdir(join(nativeRoot, "@yuuang", "ffi-rs-darwin-arm64"), { recursive: true });
  await writeFile(
    join(nativeRoot, "@yuuang", "ffi-rs-darwin-arm64", "ffi-rs.darwin-arm64.node"),
    "native",
  );
  if (includeFff) {
    await mkdir(join(nativeRoot, "@celados", "fff-bin-darwin-arm64"), { recursive: true });
    await writeFile(
      join(nativeRoot, "@celados", "fff-bin-darwin-arm64", "libfff_c.dylib"),
      "native",
    );
  }
  return app;
}
