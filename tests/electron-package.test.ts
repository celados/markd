import { afterEach, describe, expect, test } from "vitest";
import { createPackage } from "@electron/asar";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  inspectElectronPackage,
  inspectUpdateManifest,
} from "../scripts/verify-electron-package.mjs";

const scratch: string[] = [];

afterEach(async () => {
  await Promise.all(scratch.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

test("artifact inspection fails closed when fff is absent", async () => {
  const fixture = await packageFixture({ includeFff: false, includeFfi: true });
  expect(() => inspectElectronPackage(fixture, "arm64")).toThrow(
    /fff dynamic library is missing/u,
  );
});

test("artifact inspection rejects a native library in the wrong package", async () => {
  const fixture = await packageFixture({
    includeFff: true,
    includeFfi: true,
    fffPackage: "fff-bin-darwin-x64",
  });
  expect(() => inspectElectronPackage(fixture, "arm64")).toThrow(
    /fff-bin-darwin-arm64/u,
  );
});

test("artifact inspection fails closed when the ffi addon is absent", async () => {
  const fixture = await packageFixture({ includeFff: true, includeFfi: false });
  expect(() => inspectElectronPackage(fixture, "arm64")).toThrow(
    /ffi-rs native addon is missing/u,
  );
});

test("artifact inspection accepts complete Electron and native inventories", async () => {
  const fixture = await packageFixture({ includeFff: true, includeFfi: true });
  expect(inspectElectronPackage(fixture, "arm64")).toMatchObject({
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
  expect(() => inspectElectronPackage(fixture, "arm64")).toThrow(
    /target celados\/markd/u,
  );
});

test("updater manifest verifies every artifact size and SHA-512", async () => {
  const output = await manifestFixture();
  expect(inspectUpdateManifest(output)).toMatchObject({
    artifacts: ["Markd-1.0.0-mac-arm64.zip"],
  });
});

test("updater manifest rejects a missing artifact and wrong digest", async () => {
  const missing = await manifestFixture({ artifactName: "missing.zip" });
  expect(() => inspectUpdateManifest(missing)).toThrow(/artifact is missing/u);

  const wrongDigest = await manifestFixture({ sha512: "invalid" });
  expect(() => inspectUpdateManifest(wrongDigest)).toThrow(/SHA-512/u);

  const missingBlockmap = await manifestFixture({ includeBlockmap: false });
  expect(() => inspectUpdateManifest(missingBlockmap)).toThrow(/blockmap is missing/u);
});

async function packageFixture(options: {
  includeFff: boolean;
  includeFfi: boolean;
  fffPackage?: string;
  updateRepo?: string;
  arch?: "arm64" | "x64";
}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "markd-package-test-"));
  scratch.push(root);
  const arch = options.arch ?? "arm64";
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
  const ffiPackage = `ffi-rs-darwin-${arch}`;
  const ffiFile = `ffi-rs.darwin-${arch}.node`;
  if (options.includeFfi) {
    await mkdir(join(nativeRoot, "@yuuang", ffiPackage), { recursive: true });
    await writeFile(join(nativeRoot, "@yuuang", ffiPackage, ffiFile), "native");
  }
  if (options.includeFff) {
    const packageName =
      options.fffPackage ?? `fff-bin-darwin-${arch}`;
    const library = "libfff_c.dylib";
    await mkdir(join(nativeRoot, "@celados", packageName), { recursive: true });
    await writeFile(join(nativeRoot, "@celados", packageName, library), "native");
  }
  return app;
}

async function manifestFixture(options: {
  artifactName?: string;
  sha512?: string;
  includeBlockmap?: boolean;
} = {}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "markd-manifest-test-"));
  scratch.push(root);
  const actualName = "Markd-1.0.0-mac-arm64.zip";
  const body = Buffer.from("artifact");
  await writeFile(join(root, actualName), body);
  if (options.includeBlockmap !== false) {
    await writeFile(join(root, `${actualName}.blockmap`), "blockmap");
  }
  const artifactName = options.artifactName ?? actualName;
  const sha512 = options.sha512 ?? createHash("sha512").update(body).digest("base64");
  await writeFile(
    join(root, "latest-mac.yml"),
    [
      "version: 1.0.0",
      "files:",
      `  - url: ${artifactName}`,
      `    sha512: ${sha512}`,
      `    size: ${body.byteLength}`,
      `path: ${artifactName}`,
      `sha512: ${sha512}`,
      "",
    ].join("\n"),
  );
  return root;
}
