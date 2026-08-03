import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { listPackage } from "@electron/asar";
import { parse } from "yaml";

export function inspectElectronPackage(
  appPath,
  platform = process.platform,
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

  const expected = nativeLayout(platform, arch);
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

function nativeLayout(platform, arch) {
  if (!new Set(["arm64", "x64"]).has(arch)) {
    throw new Error(`Unsupported packaged architecture: ${arch}`);
  }
  if (platform === "darwin") {
    return {
      fffPackage: `fff-bin-darwin-${arch}`,
      fffFile: "libfff_c.dylib",
      ffiPackage: `ffi-rs-darwin-${arch}`,
      ffiFile: `ffi-rs.darwin-${arch}.node`,
    };
  }
  if (platform === "linux") {
    const libc = runtimeLibc();
    return {
      fffPackage: `fff-bin-linux-${arch}-${libc}`,
      fffFile: "libfff_c.so",
      ffiPackage: `ffi-rs-linux-${arch}-${libc}`,
      ffiFile: `ffi-rs.linux-${arch}-${libc}.node`,
    };
  }
  if (platform === "win32") {
    return {
      fffPackage: `fff-bin-win32-${arch}`,
      fffFile: "fff_c.dll",
      ffiPackage: `ffi-rs-win32-${arch}-msvc`,
      ffiFile: `ffi-rs.win32-${arch}-msvc.node`,
    };
  }
  throw new Error(`Unsupported packaged platform: ${platform}`);
}

function runtimeLibc() {
  const report = process.report?.getReport();
  return report && "glibcVersionRuntime" in report.header ? "gnu" : "musl";
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
