import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function electronArtifactNames(version, arch = "arm64") {
  if (!/^[0-9A-Za-z][0-9A-Za-z.-]*$/u.test(version)) {
    throw new Error(`Invalid Electron artifact version: ${version}`);
  }
  if (arch !== "arm64") {
    throw new Error(`Markd publishes only macOS arm64 artifacts, not ${arch}.`);
  }
  const stem = `Markd-${version}-mac-${arch}`;
  return {
    dmg: `${stem}.dmg`,
    zip: `${stem}.zip`,
    zipBlockmap: `${stem}.zip.blockmap`,
    manifest: "latest-mac.yml",
  };
}

export function formatArtifactEnvironment(version, arch = "arm64") {
  const names = electronArtifactNames(version, arch);
  return [
    `ELECTRON_DMG=${names.dmg}`,
    `ELECTRON_ZIP=${names.zip}`,
    `ELECTRON_ZIP_BLOCKMAP=${names.zipBlockmap}`,
    `ELECTRON_MANIFEST=${names.manifest}`,
  ].join("\n");
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath && pathToFileURL(invokedPath).href === import.meta.url) {
  const version = process.argv[2];
  if (!version) throw new Error("Usage: electron-artifacts.mjs <version> [arm64] [--github-env]");
  const arch = process.argv[3] ?? "arm64";
  const output = process.argv[4] === "--github-env"
    ? formatArtifactEnvironment(version, arch)
    : JSON.stringify(electronArtifactNames(version, arch));
  console.log(output);
}
