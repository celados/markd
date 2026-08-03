import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { listPackage } from "@electron/asar";

export function inspectElectronPackage(appPath) {
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

  const unpacked = walkFiles(unpackedPath);
  const fffLibrary = unpacked.find((path) => /libfff_c\.(dylib|so)$|fff_c\.dll$/u.test(path));
  if (!fffLibrary) throw new Error("Packaged fff dynamic library is missing from app.asar.unpacked.");
  const ffiAddon = unpacked.find((path) => /ffi-rs\..+\.node$/u.test(path));
  if (!ffiAddon) throw new Error("Packaged ffi-rs native addon is missing from app.asar.unpacked.");

  const updateConfig = join(resources, "app-update.yml");
  if (!existsSync(updateConfig)) throw new Error(`Updater provider metadata is missing: ${updateConfig}`);
  return { appPath, asarPath, fffLibrary, ffiAddon, updateConfig };
}

export function findPackagedApp(outputDir) {
  const candidates = walkDirectories(outputDir).filter((path) =>
    process.platform === "darwin"
      ? path.endsWith(`${sep}Markd.app`)
      : existsSync(join(path, "resources", "app.asar")),
  );
  if (candidates.length !== 1) {
    throw new Error(`Expected one unpacked Markd app in ${outputDir}, found ${candidates.length}.`);
  }
  return candidates[0];
}

function resolveResources(appPath) {
  return process.platform === "darwin"
    ? join(appPath, "Contents", "Resources")
    : join(appPath, "resources");
}

function walkFiles(root) {
  if (!existsSync(root)) return [];
  const files = [];
  const pending = [root];
  while (pending.length > 0) {
    const dir = pending.pop();
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) pending.push(path);
      else if (entry.isFile()) files.push(relative(root, path));
    }
  }
  return files;
}

function walkDirectories(root) {
  if (!existsSync(root)) return [];
  const directories = [];
  const pending = [root];
  while (pending.length > 0) {
    const dir = pending.pop();
    directories.push(dir);
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) pending.push(join(dir, entry.name));
    }
  }
  return directories;
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
  const appPath = process.argv[2] ?? findPackagedApp(join(process.cwd(), "release", "electron"));
  const inventory = inspectElectronPackage(appPath);
  console.log(JSON.stringify(inventory, null, 2));
}
