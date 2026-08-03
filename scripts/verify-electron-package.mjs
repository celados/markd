import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { listPackage } from "@electron/asar";
import { parse } from "yaml";

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
  return { appPath, asarPath, fffLibrary, ffiAddon, updateConfig };
}

export function inspectUpdateManifest(outputDir) {
  const manifestPath = join(outputDir, "latest-mac.yml");
  if (!existsSync(manifestPath)) throw new Error(`Updater manifest is missing: ${manifestPath}`);
  const manifest = parse(readFileSync(manifestPath, "utf8"));
  if (!manifest || !Array.isArray(manifest.files) || manifest.files.length === 0) {
    throw new Error(`Updater manifest has no artifacts: ${manifestPath}`);
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
  if (
    typeof manifest.path !== "string" ||
    !manifest.files.some((entry) => entry?.url === manifest.path)
  ) {
    throw new Error("Updater manifest primary path does not reference a verified artifact.");
  }
  return { manifestPath, artifacts: verified };
}

function nativeLayout(arch) {
  if (!new Set(["arm64", "x64"]).has(arch)) {
    throw new Error(`Unsupported packaged architecture: ${arch}`);
  }
  return {
    fffPackage: `fff-bin-darwin-${arch}`,
    fffFile: "libfff_c.dylib",
    ffiPackage: `ffi-rs-darwin-${arch}`,
    ffiFile: `ffi-rs.darwin-${arch}.node`,
  };
}

export function findPackagedApp(
  outputDir,
  arch = process.arch,
) {
  const appPath = join(outputDir, arch === "arm64" ? "mac-arm64" : "mac", "Markd.app");
  if (!existsSync(appPath)) throw new Error(`Packaged app is missing: ${appPath}`);
  return appPath;
}

function resolveResources(appPath) {
  return join(appPath, "Contents", "Resources");
}

function normalizeArchivePath(path) {
  return path.replace(/^[/\\]+/u, "").replaceAll("\\", "/");
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
  const inventory = inspectElectronPackage(appPath, arch);
  const manifest = inspectUpdateManifest(outputDir);
  console.log(JSON.stringify({ inventory, manifest }, null, 2));
}
