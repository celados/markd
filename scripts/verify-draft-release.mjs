import { createHash } from "node:crypto";
import { createReadStream, readdirSync, statSync } from "node:fs";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { electronArtifactNames } from "./electron-artifacts.mjs";
import { inspectUpdateManifest } from "./verify-electron-package.mjs";

export async function verifyDraftRelease(options) {
  const { localDir, readbackDir, metadataPath, expectedVersion } = options;
  inspectUpdateManifest(localDir, expectedVersion, "arm64");
  const names = electronArtifactNames(expectedVersion, "arm64");
  const expectedNames = Object.values(names).sort();
  const actualReadback = readdirSync(readbackDir).sort();
  if (JSON.stringify(actualReadback) !== JSON.stringify(expectedNames)) {
    throw new Error("Draft readback must contain exactly the canonical release assets.");
  }
  const release = JSON.parse(readFileSync(metadataPath, "utf8"));
  const apiNames = Array.isArray(release.assets)
    ? release.assets.map((asset) => asset?.name).sort()
    : [];
  if (
    release.tag_name !== `v${expectedVersion}` ||
    release.draft !== true ||
    release.prerelease !== false ||
    JSON.stringify(apiNames) !== JSON.stringify(expectedNames)
  ) {
    throw new Error("GitHub draft must target the expected tag with exactly the canonical assets.");
  }
  const apiAssets = new Map(release.assets.map((asset) => [asset.name, asset]));
  const assets = {};
  for (const name of expectedNames) {
    const local = await digestFile(join(localDir, name));
    const readback = await digestFile(join(readbackDir, name));
    const api = apiAssets.get(name);
    if (
      local.size !== readback.size ||
      local.sha256 !== readback.sha256 ||
      local.sha512 !== readback.sha512
    ) {
      throw new Error(`Authenticated draft readback does not match local bytes: ${name}`);
    }
    if (
      !api ||
      api.state !== "uploaded" ||
      api.size !== readback.size ||
      api.digest !== `sha256:${readback.sha256}`
    ) {
      throw new Error(`GitHub draft API metadata does not match readback bytes: ${name}`);
    }
    assets[name] = readback;
  }
  return { version: expectedVersion, assets };
}

async function digestFile(path) {
  const sha256 = createHash("sha256");
  const sha512 = createHash("sha512");
  for await (const chunk of createReadStream(path)) {
    sha256.update(chunk);
    sha512.update(chunk);
  }
  return {
    size: statSync(path).size,
    sha256: sha256.digest("hex"),
    sha512: sha512.digest("base64"),
  };
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath && pathToFileURL(invokedPath).href === import.meta.url) {
  const [expectedVersion, localDir, readbackDir, metadataPath] = process.argv.slice(2);
  if (!expectedVersion || !localDir || !readbackDir || !metadataPath) {
    throw new Error(
      "Usage: verify-draft-release.mjs <version> <local-dir> <readback-dir> <metadata-json>",
    );
  }
  console.log(JSON.stringify(await verifyDraftRelease({
    expectedVersion,
    localDir: resolve(localDir),
    readbackDir: resolve(readbackDir),
    metadataPath: resolve(metadataPath),
  }), null, 2));
}
