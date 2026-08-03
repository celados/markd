import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, extname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { extractFile, listPackage, statFile } from "@electron/asar";
import { parse } from "yaml";
import { electronArtifactNames } from "./electron-artifacts.mjs";

export function inspectElectronPackage(
  appPath,
  arch = process.arch,
) {
  const resources = resolveResources(appPath);
  const asarPath = join(resources, "app.asar");
  const unpackedPath = `${asarPath}.unpacked`;
  if (!existsSync(asarPath)) throw new Error(`Packaged ASAR is missing: ${asarPath}`);
  if (!existsSync(unpackedPath)) {
    throw new Error(`ASAR-unpacked native payload is missing: ${unpackedPath}`);
  }

  const archived = listPackage(asarPath).map(normalizeArchivePath);
  const forbiddenArchiveEntries = archived.filter((path) =>
    path.startsWith("node_modules/@tauri-apps/") || path.startsWith("node_modules/@octanejs/tauri/"),
  );
  if (forbiddenArchiveEntries.length > 0) {
    throw new Error(`Packaged ASAR contains retired desktop dependencies: ${forbiddenArchiveEntries.join(", ")}.`);
  }
  for (const required of [
    "dist/index.html",
    "dist-electron/main.js",
    "dist-electron/preload.mjs",
    "dist-electron/engine.js",
    "node_modules/electron-updater/package.json",
  ]) {
    if (!archived.includes(required)) throw new Error(`Packaged entry is missing: ${required}`);
  }

  const expected = nativeLayout(arch);
  const fffLibrary = join("node_modules", "@celados", expected.fffPackage, expected.fffFile);
  if (!existsSync(join(unpackedPath, fffLibrary))) {
    throw new Error(`Packaged fff dynamic library is missing: ${fffLibrary}`);
  }
  const ffiAddon = join("node_modules", "@yuuang", expected.ffiPackage, expected.ffiFile);
  if (!existsSync(join(unpackedPath, ffiAddon))) {
    throw new Error(`Packaged ffi-rs native addon is missing: ${ffiAddon}`);
  }
  const nativeFiles = listNativeFiles(unpackedPath);
  const expectedNativeFiles = [fffLibrary, ffiAddon].sort();
  const archivedNativeFiles = archived
    .filter((path) => new Set([".dylib", ".node"]).has(extname(path)))
    .sort();
  if (JSON.stringify(archivedNativeFiles) !== JSON.stringify(expectedNativeFiles)) {
    throw new Error(
      `Packaged ASAR contains an unexpected native payload: ${archivedNativeFiles.join(", ") || "none"}.`,
    );
  }
  for (const path of expectedNativeFiles) {
    const entry = statFile(asarPath, path);
    if (!("unpacked" in entry) || entry.unpacked !== true) {
      throw new Error(`Packaged native payload must be ASAR-unpacked: ${path}.`);
    }
  }
  if (JSON.stringify(nativeFiles) !== JSON.stringify(expectedNativeFiles)) {
    throw new Error(
      `Packaged app contains an unexpected native payload: ${nativeFiles.join(", ") || "none"}.`,
    );
  }
  const nativeVersions = inspectNativeVersions(asarPath, expected);

  const updateConfig = join(resources, "app-update.yml");
  if (!existsSync(updateConfig)) throw new Error(`Updater provider metadata is missing: ${updateConfig}`);
  const provider = parse(readFileSync(updateConfig, "utf8"));
  if (
    provider?.provider !== "github" ||
    provider?.owner !== "celados" ||
    provider?.repo !== "markd"
  ) {
    throw new Error("Packaged updater provider must target celados/markd GitHub releases.");
  }
  return { appPath, asarPath, fffLibrary, ffiAddon, nativeFiles, nativeVersions, updateConfig };
}

export function inspectElectronOnlySource(root = process.cwd()) {
  const retiredPaths = ["src-tauri", "Cargo.toml", "Cargo.lock"]
    .filter((path) => existsSync(join(root, path)));
  if (retiredPaths.length > 0) {
    throw new Error(`Retired desktop source remains: ${retiredPaths.join(", ")}.`);
  }
  const forbidden = /@tauri-apps|@octanejs\/tauri|src-tauri|\bcargo\s+test\b/u;
  const checkedFiles = [
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    ".github/workflows/ci.yml",
    ".github/workflows/release-macos.yml",
    "electron-builder.yml",
  ];
  const contaminated = checkedFiles.filter((path) =>
    forbidden.test(readFileSync(join(root, path), "utf8")),
  );
  if (contaminated.length > 0) {
    throw new Error(`Retired desktop inventory remains in: ${contaminated.join(", ")}.`);
  }
  const classifiedChecks = [
    {
      name: "runtime",
      files: [...sourceFiles(join(root, "src")), ...sourceFiles(join(root, "electron"))],
      forbidden: /@tauri-apps|@octanejs\/tauri|__TAURI|src\/lib\/ipc/u,
    },
    {
      name: "tests",
      files: [...sourceFiles(join(root, "test")), ...sourceFiles(join(root, "tests"))]
        .filter((path) => !path.endsWith("tests/electron-package.test.ts")),
      forbidden: /__TAURI|tauri-fixture|record_search_access|move_entry|write_note|create_folder|rename_entry/u,
    },
    {
      name: "current docs",
      files: ["AGENTS.md", "README.md", "CONTRIBUTING.md", ".agents/backlog.md"]
        .map((path) => join(root, path)),
      forbidden: /legacy Tauri tree|pnpm tauri|src-tauri|cargo test|Rust owns|lib\/ipc/u,
    },
  ];
  for (const check of classifiedChecks) {
    const failures = check.files.filter((path) => check.forbidden.test(readFileSync(path, "utf8")));
    if (failures.length > 0) {
      throw new Error(`${check.name} still contains retired desktop seams: ${failures.join(", ")}.`);
    }
  }
  return {
    checkedFiles,
    retiredPaths: [],
    classifiedChecks: Object.fromEntries(
      classifiedChecks.map((check) => [check.name, check.files.length]),
    ),
  };
}

export function inspectUpdateManifest(outputDir, expectedVersion, arch = "arm64") {
  const names = electronArtifactNames(expectedVersion, arch);
  const releaseArtifacts = inspectReleaseArtifacts(outputDir, expectedVersion, arch);
  const manifestPath = join(outputDir, "latest-mac.yml");
  if (!existsSync(manifestPath)) throw new Error(`Updater manifest is missing: ${manifestPath}`);
  const manifest = parse(readFileSync(manifestPath, "utf8"));
  if (manifest?.version !== expectedVersion) {
    throw new Error(`Updater manifest version must be ${expectedVersion}.`);
  }
  if (!Array.isArray(manifest.files) || manifest.files.length !== 1) {
    throw new Error(`Updater manifest must contain exactly one macOS arm64 ZIP: ${manifestPath}`);
  }
  if (manifest.path !== names.zip || manifest.files[0]?.url !== names.zip) {
    throw new Error(`Updater manifest primary path must be ${names.zip}.`);
  }
  const verified = manifest.files.map((entry) => {
    if (
      !entry ||
      typeof entry.url !== "string" ||
      basename(entry.url) !== entry.url ||
      typeof entry.size !== "number" ||
      typeof entry.sha512 !== "string"
    ) {
      throw new Error("Updater manifest contains an invalid artifact entry.");
    }
    const artifactPath = join(outputDir, entry.url);
    if (!existsSync(artifactPath)) {
      throw new Error(`Updater artifact is missing: ${entry.url}`);
    }
    const bytes = readFileSync(artifactPath);
    if (bytes.byteLength !== entry.size) {
      throw new Error(`Updater artifact size does not match: ${entry.url}`);
    }
    const digest = createHash("sha512").update(bytes).digest("base64");
    if (digest !== entry.sha512) {
      throw new Error(`Updater artifact SHA-512 does not match: ${entry.url}`);
    }
    const blockmapPath = `${artifactPath}.blockmap`;
    if (!existsSync(blockmapPath) || statSync(blockmapPath).size === 0) {
      throw new Error(`Updater blockmap is missing: ${entry.url}.blockmap`);
    }
    return entry.url;
  });
  if (manifest.sha512 !== manifest.files[0].sha512) {
    throw new Error("Updater manifest top-level SHA-512 does not match the primary artifact.");
  }
  return {
    manifestPath,
    artifacts: verified,
    primaryArtifact: names.zip,
    releaseArtifacts,
  };
}

export function inspectReleaseArtifacts(outputDir, expectedVersion, arch = "arm64") {
  const names = electronArtifactNames(expectedVersion, arch);
  const expected = Object.values(names).sort();
  const diagnostics = new Set(["builder-debug.yml", "builder-effective-config.yaml"]);
  const actualFiles = readdirSync(outputDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort();
  const actual = actualFiles.filter((name) => !diagnostics.has(name));
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Electron release payload must contain exactly ${expected.join(", ")}; found ${actual.join(", ") || "none"}.`,
    );
  }
  for (const name of expected) {
    if (statSync(join(outputDir, name)).size === 0) {
      throw new Error(`Electron release artifact is empty: ${name}`);
    }
  }
  return actual;
}

function nativeLayout(arch) {
  if (arch !== "arm64") {
    throw new Error(`Markd packages only macOS arm64, not ${arch}.`);
  }
  return {
    fffPackage: `fff-bin-darwin-${arch}`,
    fffFile: "libfff_c.dylib",
    ffiPackage: `ffi-rs-darwin-${arch}`,
    ffiFile: `ffi-rs.darwin-${arch}.node`,
  };
}

function inspectNativeVersions(asarPath, expected) {
  const pairs = [
    {
      name: "fff",
      wrapper: "node_modules/@celados/fff-node/package.json",
      native: `node_modules/@celados/${expected.fffPackage}/package.json`,
    },
    {
      name: "ffi-rs",
      wrapper: "node_modules/ffi-rs/package.json",
      native: `node_modules/@yuuang/${expected.ffiPackage}/package.json`,
    },
  ];
  return Object.fromEntries(pairs.map((pair) => {
    const wrapperVersion = packageVersion(asarPath, pair.wrapper);
    const nativeVersion = packageVersion(asarPath, pair.native);
    if (wrapperVersion !== nativeVersion) {
      throw new Error(
        `Packaged ${pair.name} wrapper/native version mismatch: ${wrapperVersion} != ${nativeVersion}.`,
      );
    }
    return [pair.name, wrapperVersion];
  }));
}

function packageVersion(asarPath, path) {
  let manifest;
  try {
    manifest = JSON.parse(extractFile(asarPath, path).toString("utf8"));
  } catch {
    throw new Error(`Packaged dependency manifest is missing or invalid: ${path}.`);
  }
  if (typeof manifest?.version !== "string" || manifest.version.length === 0) {
    throw new Error(`Packaged dependency version is invalid: ${path}.`);
  }
  return manifest.version;
}

export function findPackagedApp(
  outputDir,
  arch = process.arch,
) {
  nativeLayout(arch);
  const appPath = join(outputDir, "mac-arm64", "Markd.app");
  if (!existsSync(appPath)) throw new Error(`Packaged app is missing: ${appPath}`);
  return appPath;
}

function resolveResources(appPath) {
  return join(appPath, "Contents", "Resources");
}

function normalizeArchivePath(path) {
  return path.replace(/^[/\\]+/u, "").replaceAll("\\", "/");
}

function listNativeFiles(root) {
  const files = [];
  const visit = (folder) => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) {
        visit(path);
      } else if (entry.isFile() && new Set([".dylib", ".node"]).has(extname(entry.name))) {
        files.push(normalizeArchivePath(relative(root, path)));
      }
    }
  };
  visit(root);
  return files.sort();
}

function sourceFiles(root) {
  if (!existsSync(root)) return [];
  const files = [];
  const visit = (folder) => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && /\.(?:js|mjs|ts|tsx|tsrx)$/u.test(entry.name)) files.push(path);
    }
  };
  visit(root);
  return files;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (
  invokedPath &&
  statSync(invokedPath).isFile() &&
  pathToFileURL(invokedPath).href === import.meta.url
) {
  const outputDir = join(process.cwd(), "release", "electron");
  const appPath = process.argv[2] ?? findPackagedApp(outputDir);
  const arch = process.argv[3] ?? process.arch;
  const expectedVersion = process.argv[4] ?? JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")).version;
  const source = inspectElectronOnlySource();
  const inventory = inspectElectronPackage(appPath, arch);
  const manifest = inspectUpdateManifest(outputDir, expectedVersion, arch);
  console.log(JSON.stringify({ source, inventory, manifest }, null, 2));
}
