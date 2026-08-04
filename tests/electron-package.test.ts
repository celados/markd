import { afterEach, describe, expect, test } from "vitest";
import { createPackageWithOptions } from "@electron/asar";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parse } from "yaml";
import {
  inspectElectronPackage,
  inspectElectronOnlySource,
  inspectUpdateManifest,
} from "../scripts/verify-electron-package.mjs";
import { electronArtifactNames } from "../scripts/electron-artifacts.mjs";

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
    nativeFiles: [
      "node_modules/@celados/fff-bin-darwin-arm64/libfff_c.dylib",
      "node_modules/@yuuang/ffi-rs-darwin-arm64/ffi-rs.darwin-arm64.node",
    ],
    nativeVersions: {
      fff: "0.10.2-nightly.dbc0f62",
      "ffi-rs": "1.3.4",
    },
  });
});

test.each([
  ["fff", { fffNativeVersion: "0.10.3" }],
  ["ffi-rs", { ffiNativeVersion: "1.3.5" }],
])("artifact inspection rejects %s wrapper/native version drift", async (_name, versions) => {
  const fixture = await packageFixture({
    includeFff: true,
    includeFfi: true,
    ...versions,
  });
  expect(() => inspectElectronPackage(fixture, "arm64")).toThrow(/wrapper\/native version mismatch/u);
});

test("source inventory rejects every retired desktop path and dependency", async () => {
  expect(inspectElectronOnlySource()).toMatchObject({ retiredPaths: [] });
  const root = await mkdtemp(join(tmpdir(), "markd-electron-only-test-"));
  scratch.push(root);
  await mkdir(join(root, "src-tauri"));
  for (const path of [
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    ".github/workflows/ci.yml",
    ".github/workflows/release-macos.yml",
    "electron-builder.yml",
  ]) {
    await mkdir(join(root, path, ".."), { recursive: true });
    await writeFile(join(root, path), "{}");
  }
  expect(() => inspectElectronOnlySource(root)).toThrow(/Retired desktop source/u);
});

test("artifact inspection rejects retired desktop dependencies", async () => {
  const fixture = await packageFixture({
    includeFff: true,
    includeFfi: true,
    extraArchivedFiles: ["node_modules/@tauri-apps/api/package.json"],
  });
  expect(() => inspectElectronPackage(fixture, "arm64")).toThrow(/retired desktop dependencies/u);
});

test("arm64 packaging excludes foreign native packages without weakening inventory", async () => {
  const config = parse(
    await readFile(join(process.cwd(), "electron-builder.yml"), "utf8"),
  ) as { asarUnpack: string[]; files: string[] };
  const nativeExclusions = config.files.filter((entry) =>
    entry.startsWith("!node_modules/@celados/") ||
    entry.startsWith("!node_modules/@yuuang/"),
  );

  expect(nativeExclusions).toEqual([
    "!node_modules/@celados/fff-bin-darwin-x64/**/*",
    "!node_modules/@yuuang/ffi-rs-android-arm64/**/*",
    "!node_modules/@yuuang/ffi-rs-darwin-x64/**/*",
    "!node_modules/@yuuang/ffi-rs-linux-arm-gnueabihf/**/*",
    "!node_modules/@yuuang/ffi-rs-linux-arm64-gnu/**/*",
    "!node_modules/@yuuang/ffi-rs-linux-arm64-musl/**/*",
    "!node_modules/@yuuang/ffi-rs-linux-x64-gnu/**/*",
    "!node_modules/@yuuang/ffi-rs-linux-x64-musl/**/*",
    "!node_modules/@yuuang/ffi-rs-win32-arm64-msvc/**/*",
    "!node_modules/@yuuang/ffi-rs-win32-ia32-msvc/**/*",
    "!node_modules/@yuuang/ffi-rs-win32-x64-msvc/**/*",
  ]);
  expect(config.asarUnpack).toEqual([
    "node_modules/@celados/fff-bin-darwin-arm64/**/*",
    "node_modules/@yuuang/ffi-rs-darwin-arm64/**/*",
  ]);
});

test("artifact inspection rejects wrong-arch and extra native payloads", async () => {
  const wrongArch = await packageFixture({
    includeFff: true,
    includeFfi: true,
    extraNativeFiles: ["node_modules/@celados/fff-bin-darwin-x64/libfff_c.dylib"],
  });
  expect(() => inspectElectronPackage(wrongArch, "arm64")).toThrow(/unexpected native payload/u);

  const extra = await packageFixture({
    includeFff: true,
    includeFfi: true,
    extraNativeFiles: ["node_modules/example/extra.node"],
  });
  expect(() => inspectElectronPackage(extra, "arm64")).toThrow(/unexpected native payload/u);
});

test("artifact inspection rejects a native payload hidden inside the ASAR", async () => {
  const fixture = await packageFixture({
    includeFff: true,
    includeFfi: true,
    archivedOnlyNativeFiles: ["node_modules/example/hidden.node"],
  });
  expect(() => inspectElectronPackage(fixture, "arm64")).toThrow(
    /ASAR contains an unexpected native payload/u,
  );
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
  expect(inspectUpdateManifest(output, "1.0.0", "arm64")).toMatchObject({
    artifacts: ["Markd-1.0.0-mac-arm64.zip"],
    primaryArtifact: "Markd-1.0.0-mac-arm64.zip",
  });
});

test("updater manifest rejects a missing artifact and wrong digest", async () => {
  const missing = await manifestFixture({ artifactName: "missing.zip" });
  expect(() => inspectUpdateManifest(missing, "1.0.0", "arm64")).toThrow(/primary path/u);

  const wrongDigest = await manifestFixture({ sha512: "invalid" });
  expect(() => inspectUpdateManifest(wrongDigest, "1.0.0", "arm64")).toThrow(/SHA-512/u);

  const missingBlockmap = await manifestFixture({ includeBlockmap: false });
  expect(() => inspectUpdateManifest(missingBlockmap, "1.0.0", "arm64")).toThrow(
    /release payload must contain exactly/u,
  );
});

test("updater manifest rejects stale, x64, and mismatched top-level metadata", async () => {
  const stale = await manifestFixture({ artifactName: "Markd-0.9.0-mac-arm64.zip" });
  expect(() => inspectUpdateManifest(stale, "1.0.0", "arm64")).toThrow(/primary path/u);

  const x64 = await manifestFixture({ artifactName: "Markd-1.0.0-mac-x64.zip" });
  expect(() => inspectUpdateManifest(x64, "1.0.0", "arm64")).toThrow(/primary path/u);

  const wrongVersion = await manifestFixture({ manifestVersion: "0.9.0" });
  expect(() => inspectUpdateManifest(wrongVersion, "1.0.0", "arm64")).toThrow(/version/u);

  const wrongTopLevelDigest = await manifestFixture({ topLevelSha512: "invalid" });
  expect(() => inspectUpdateManifest(wrongTopLevelDigest, "1.0.0", "arm64")).toThrow(
    /top-level SHA-512/u,
  );

  const staleOutput = await manifestFixture({
    extraArtifactName: "Markd-0.9.0-mac-arm64.dmg",
  });
  expect(() => inspectUpdateManifest(staleOutput, "1.0.0", "arm64")).toThrow(
    /release payload must contain exactly/u,
  );
});

test("artifact names share one canonical macOS arm64 contract", () => {
  expect(electronArtifactNames("1.2.3", "arm64")).toEqual({
    dmg: "Markd-1.2.3-mac-arm64.dmg",
    zip: "Markd-1.2.3-mac-arm64.zip",
    zipBlockmap: "Markd-1.2.3-mac-arm64.zip.blockmap",
    manifest: "latest-mac.yml",
  });
  expect(() => electronArtifactNames("1.2.3", "x64")).toThrow(/arm64/u);
});

test("release workflow removes every exact draft transaction readback target", async () => {
  const workflow = await readFile(
    join(process.cwd(), ".github", "workflows", "release-macos.yml"),
    "utf8",
  );
  expect(workflow).toContain(
    'existing_root="$RUNNER_TEMP/markd-draft-existing-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"',
  );
  expect(workflow).toContain('existing="$existing_root/$name"');
  const cleanup = workflow.slice(workflow.indexOf("- name: Remove isolated release roots"));
  expect(cleanup).not.toMatch(/rm -rf [^\n]*\*/u);
  expect(cleanup).toContain('rm -rf "$path"');
  for (const target of [
    "markd-draft-existing-$run_key",
    "markd-draft-readback-$run_key",
    "markd-draft-before-$run_key.json",
    "markd-draft-assets-$run_key.json",
    "markd-draft-final-$run_key.json",
  ]) {
    expect(cleanup).toContain(`"$RUNNER_TEMP/${target}"`);
  }
  expect(workflow).not.toContain("markd-existing-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT-$name");
});

test("release workflow preflights P12 signing and verifies the signed DMG before notarization", async () => {
  const [workflow, configText] = await Promise.all([
    readFile(join(process.cwd(), ".github", "workflows", "release-macos.yml"), "utf8"),
    readFile(join(process.cwd(), "electron-builder.yml"), "utf8"),
  ]);
  const config = parse(configText) as { dmg?: { sign?: boolean } };
  expect(config.dmg?.sign).toBe(true);

  const preflight = workflow.indexOf("- name: Preflight Developer ID signing identity");
  const cleanup = workflow.indexOf("- name: Remove signing identity preflight");
  const install = workflow.indexOf("- name: Install dependencies");
  const build = workflow.indexOf("- name: Build, sign, and notarize Electron artifacts");
  const dmgVerification = workflow.indexOf('codesign --verify --strict --verbose=2 "$dmg"');
  const dmgNotarization = workflow.indexOf('xcrun notarytool submit "$dmg"');
  expect([preflight, cleanup, install, build, dmgVerification, dmgNotarization])
    .not.toContain(-1);
  expect(preflight).toBeLessThan(cleanup);
  expect(cleanup).toBeLessThan(install);
  expect(install).toBeLessThan(build);
  expect(build).toBeLessThan(dmgVerification);
  expect(dmgVerification).toBeLessThan(dmgNotarization);

  const preflightBlock = workflow.slice(preflight, cleanup);
  const keychainSnapshot = preflightBlock.indexOf(
    'security list-keychains -d user > "$keychain_list_tmp"',
  );
  const keychainSnapshotReady = preflightBlock.indexOf(
    'mv "$keychain_list_tmp" "$keychain_list"',
  );
  const keychainActivation = preflightBlock.indexOf(
    'security list-keychains -d user -s "$keychain" "${existing_keychains[@]}"',
  );
  const probeSigning = preflightBlock.indexOf(
    'codesign --force --timestamp=none --sign "$identity_hash" "$probe"',
  );
  expect([keychainSnapshot, keychainSnapshotReady, keychainActivation, probeSigning])
    .not.toContain(-1);
  expect(keychainSnapshot).toBeLessThan(keychainSnapshotReady);
  expect(keychainSnapshotReady).toBeLessThan(keychainActivation);
  expect(keychainActivation).toBeLessThan(probeSigning);
  expect(preflightBlock).not.toContain('security list-keychains -d user > "$keychain_list"');
  expect(preflightBlock).not.toContain('test -s "$keychain_list');
  expect(preflightBlock).toContain("security import \"$p12\"");
  expect(preflightBlock).toContain("security find-identity -v -p codesigning");
  expect(preflightBlock).toContain('security find-key -t private "$keychain"');
  expect(preflightBlock).not.toContain("security find-key -t private -s");
  expect(preflightBlock).toContain('cp /usr/bin/true "$probe"');
  expect(preflightBlock).not.toContain("ditto /usr/bin/true");
  expect(preflightBlock).not.toContain('--keychain "$keychain" "$probe"');
  const cleanupBlock = workflow.slice(cleanup, install);
  expect(cleanupBlock).toContain("if: always()");
  expect(cleanupBlock).toContain("failed=0");
  expect(cleanupBlock).toContain('if [ -f "$keychain_list" ]; then');
  expect(cleanupBlock).not.toContain('if [ -f "$keychain_list_tmp" ]; then');
  const keychainRestore = cleanupBlock.indexOf(
    'security list-keychains -d user -s "${previous_keychains[@]}" || failed=1',
  );
  const keychainDelete = cleanupBlock.indexOf(
    'security delete-keychain "$keychain" || failed=1',
  );
  expect([keychainRestore, keychainDelete]).not.toContain(-1);
  expect(keychainRestore).toBeLessThan(keychainDelete);
  expect(cleanupBlock).toContain('security delete-keychain "$keychain" || failed=1');
  expect(cleanupBlock).toContain('rm -f "$keychain_list_tmp" || failed=1');
  expect(cleanupBlock).toContain('rm -f "$keychain_list" || failed=1');
  expect(cleanupBlock).toContain('rm -f "$p12" || failed=1');
  expect(cleanupBlock).toContain('rm -f "$probe" || failed=1');
  expect(cleanupBlock).toContain('test ! -e "$keychain" || failed=1');
  expect(cleanupBlock).toContain('test ! -e "$p12" || failed=1');
  expect(cleanupBlock).toContain('test ! -e "$probe" || failed=1');
  expect(cleanupBlock).toContain('test ! -e "$keychain_list_tmp" || failed=1');
  expect(cleanupBlock).toContain('test ! -e "$keychain_list" || failed=1');
  expect(cleanupBlock).toContain('exit "$failed"');
  expect(cleanupBlock).not.toMatch(/rm -rf [^\n]*\*/u);
});

test("release installed journey passes its app through the packaged smoke CLI", async () => {
  const workflow = await readFile(
    join(process.cwd(), ".github", "workflows", "release-macos.yml"),
    "utf8",
  );
  expect(workflow).toContain(
    'run: MARKD_E2E_BACKGROUND=1 pnpm run test:packaged -- "$INSTALLED_APP"',
  );
});

async function packageFixture(options: {
  includeFff: boolean;
  includeFfi: boolean;
  fffPackage?: string;
  updateRepo?: string;
  arch?: "arm64" | "x64";
  extraNativeFiles?: string[];
  archivedOnlyNativeFiles?: string[];
  extraArchivedFiles?: string[];
  fffNativeVersion?: string;
  ffiNativeVersion?: string;
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
  await mkdir(join(source, "node_modules", "@celados", "fff-node"), { recursive: true });
  await writeFile(
    join(source, "node_modules", "@celados", "fff-node", "package.json"),
    JSON.stringify({ version: "0.10.2-nightly.dbc0f62" }),
  );
  await mkdir(join(source, "node_modules", "ffi-rs"), { recursive: true });
  await writeFile(
    join(source, "node_modules", "ffi-rs", "package.json"),
    JSON.stringify({ version: "1.3.4" }),
  );
  const ffiPackage = `ffi-rs-darwin-${arch}`;
  const ffiFile = `ffi-rs.darwin-${arch}.node`;
  if (options.includeFfi) {
    await mkdir(join(source, "node_modules", "@yuuang", ffiPackage), { recursive: true });
    await writeFile(join(source, "node_modules", "@yuuang", ffiPackage, ffiFile), "native");
    await writeFile(
      join(source, "node_modules", "@yuuang", ffiPackage, "package.json"),
      JSON.stringify({ version: options.ffiNativeVersion ?? "1.3.4" }),
    );
  }
  if (options.includeFff) {
    const packageName =
      options.fffPackage ?? `fff-bin-darwin-${arch}`;
    const library = "libfff_c.dylib";
    await mkdir(join(source, "node_modules", "@celados", packageName), { recursive: true });
    await writeFile(join(source, "node_modules", "@celados", packageName, library), "native");
    await writeFile(
      join(source, "node_modules", "@celados", packageName, "package.json"),
      JSON.stringify({ version: options.fffNativeVersion ?? "0.10.2-nightly.dbc0f62" }),
    );
  }
  for (const path of [...(options.extraNativeFiles ?? []), ...(options.archivedOnlyNativeFiles ?? [])]) {
    await mkdir(join(source, path, ".."), { recursive: true });
    await writeFile(join(source, path), "native");
  }
  for (const path of options.extraArchivedFiles ?? []) {
    await mkdir(join(source, path, ".."), { recursive: true });
    await writeFile(join(source, path), "fixture");
  }
  await mkdir(resources, { recursive: true });
  await createPackageWithOptions(source, join(resources, "app.asar"), {
    // Production only unpacks the two supported arm64 packages; extras must stay visible to the verifier.
    unpackDir: "node_modules/{@celados/fff-bin-darwin-arm64,@yuuang/ffi-rs-darwin-arm64}",
  });
  const [owner, repo] = (options.updateRepo ?? "celados/markd").split("/");
  await writeFile(
    join(resources, "app-update.yml"),
    `provider: github\nowner: ${owner}\nrepo: ${repo}\n`,
  );
  const nativeRoot = join(resources, "app.asar.unpacked");
  for (const path of options.extraNativeFiles ?? []) {
    await mkdir(join(nativeRoot, path, ".."), { recursive: true });
    await writeFile(join(nativeRoot, path), "native");
  }
  return app;
}

async function manifestFixture(options: {
  artifactName?: string;
  sha512?: string;
  includeBlockmap?: boolean;
  manifestVersion?: string;
  topLevelSha512?: string;
  extraArtifactName?: string;
} = {}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "markd-manifest-test-"));
  scratch.push(root);
  const actualName = "Markd-1.0.0-mac-arm64.zip";
  const dmgName = "Markd-1.0.0-mac-arm64.dmg";
  const body = Buffer.from("artifact");
  const dmgBody = Buffer.from("dmg");
  await writeFile(join(root, actualName), body);
  await writeFile(join(root, dmgName), dmgBody);
  if (options.includeBlockmap !== false) {
    await writeFile(join(root, `${actualName}.blockmap`), "blockmap");
  }
  if (options.extraArtifactName) {
    await writeFile(join(root, options.extraArtifactName), "stale");
  }
  const artifactName = options.artifactName ?? actualName;
  const sha512 = options.sha512 ?? createHash("sha512").update(body).digest("base64");
  await writeFile(
    join(root, "latest-mac.yml"),
    [
      `version: ${options.manifestVersion ?? "1.0.0"}`,
      "files:",
      `  - url: ${artifactName}`,
      `    sha512: ${sha512}`,
      `    size: ${body.byteLength}`,
      `path: ${artifactName}`,
      `sha512: ${options.topLevelSha512 ?? sha512}`,
      "",
    ].join("\n"),
  );
  return root;
}
