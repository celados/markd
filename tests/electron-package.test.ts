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
  const fixture = await packageFixture({ includeFff: false, includeFfi: true });
  expect(() => inspectElectronPackage(fixture)).toThrow(/fff dynamic library is missing/u);
});

test("artifact inspection rejects a native library in the wrong package", async () => {
  const fixture = await packageFixture({
    includeFff: true,
    includeFfi: true,
    fffPackage: "fff-bin-darwin-x64",
  });
  expect(() => inspectElectronPackage(fixture, "darwin", "arm64")).toThrow(
    /fff-bin-darwin-arm64/u,
  );
});

test("artifact inspection fails closed when the ffi addon is absent", async () => {
  const fixture = await packageFixture({ includeFff: true, includeFfi: false });
  expect(() => inspectElectronPackage(fixture)).toThrow(/ffi-rs native addon is missing/u);
});

test("artifact inspection accepts complete Electron and native inventories", async () => {
  const fixture = await packageFixture({ includeFff: true, includeFfi: true });
  expect(inspectElectronPackage(fixture)).toMatchObject({
    fffLibrary: expect.stringMatching(/libfff_c\.dylib$/u),
    ffiAddon: expect.stringMatching(/\.node$/u),
  });
});

test("artifact inspection rejects updater metadata for another repository", async () => {
  const fixture = await packageFixture({
    includeFff: true,
    includeFfi: true,
    updateRepo: "upstream/markd",
  });
  expect(() => inspectElectronPackage(fixture)).toThrow(/target celados\/markd/u);
});

async function packageFixture(options: {
  includeFff: boolean;
  includeFfi: boolean;
  fffPackage?: string;
  updateRepo?: string;
}): Promise<string> {
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
  const [owner, repo] = (options.updateRepo ?? "celados/markd").split("/");
  await writeFile(
    join(resources, "app-update.yml"),
    `provider: github\nowner: ${owner}\nrepo: ${repo}\n`,
  );
  const nativeRoot = join(resources, "app.asar.unpacked", "node_modules");
  if (options.includeFfi) {
    await mkdir(join(nativeRoot, "@yuuang", "ffi-rs-darwin-arm64"), { recursive: true });
    await writeFile(
      join(nativeRoot, "@yuuang", "ffi-rs-darwin-arm64", "ffi-rs.darwin-arm64.node"),
      "native",
    );
  }
  if (options.includeFff) {
    const packageName = options.fffPackage ?? "fff-bin-darwin-arm64";
    await mkdir(join(nativeRoot, "@celados", packageName), { recursive: true });
    await writeFile(join(nativeRoot, "@celados", packageName, "libfff_c.dylib"), "native");
  }
  return app;
}
