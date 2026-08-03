import { createHash } from "node:crypto";
import { createReadStream, existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parse } from "yaml";
import { electronArtifactNames } from "./electron-artifacts.mjs";
import { inspectUpdateManifest } from "./verify-electron-package.mjs";

const publicReleaseRoot = "https://github.com/celados/markd/releases/download";

export async function verifyRemoteRelease(options) {
  const {
    outputDir,
    expectedVersion,
    arch = "arm64",
    baseUrl = `${publicReleaseRoot}/v${expectedVersion}`,
    apiUrl = `https://api.github.com/repos/celados/markd/releases/tags/v${expectedVersion}`,
    latestApiUrl = "https://api.github.com/repos/celados/markd/releases/latest",
    fetchImpl = fetch,
  } = options;
  const localManifest = inspectUpdateManifest(outputDir, expectedVersion, arch);
  const names = electronArtifactNames(expectedVersion, arch);
  const expectedNames = [names.dmg, names.zip, names.zipBlockmap, names.manifest];
  const remote = {};
  const releaseResponse = await fetchImpl(apiUrl, {
    headers: {
      accept: "application/vnd.github+json",
      "user-agent": "markd-release-verifier",
      "x-github-api-version": "2022-11-28",
    },
  });
  if (!releaseResponse.ok) {
    throw new Error(`Anonymous GitHub Release readback failed: HTTP ${releaseResponse.status}`);
  }
  const release = await releaseResponse.json();
  const latestResponse = await fetchImpl(latestApiUrl, {
    headers: {
      accept: "application/vnd.github+json",
      "user-agent": "markd-release-verifier",
      "x-github-api-version": "2022-11-28",
    },
  });
  if (!latestResponse.ok) {
    throw new Error(`Anonymous GitHub latest release readback failed: HTTP ${latestResponse.status}`);
  }
  const latest = await latestResponse.json();
  if (latest.tag_name !== `v${expectedVersion}` || latest.draft !== false || latest.prerelease !== false) {
    throw new Error(`GitHub latest stable release must resolve to v${expectedVersion}.`);
  }
  const actualNames = Array.isArray(release.assets)
    ? release.assets.map((asset) => asset?.name).sort()
    : [];
  if (
    release.tag_name !== `v${expectedVersion}` ||
    release.draft !== false ||
    release.prerelease !== false ||
    JSON.stringify(actualNames) !== JSON.stringify([...expectedNames].sort())
  ) {
    throw new Error("GitHub Release must be a public stable release with exactly the canonical assets.");
  }
  const apiAssets = new Map(release.assets.map((asset) => [asset.name, asset]));

  for (const name of expectedNames) {
    const localPath = join(outputDir, name);
    if (!existsSync(localPath)) throw new Error(`Local release artifact is missing: ${name}`);
    const response = await fetchImpl(`${baseUrl}/${encodeURIComponent(name)}`, {
      redirect: "follow",
      headers: { "user-agent": "markd-release-verifier" },
    });
    if (!response.ok || !response.body) {
      throw new Error(`Anonymous release readback failed for ${name}: HTTP ${response.status}`);
    }
    const result = await digestResponse(response, name);
    const local = await digestFile(localPath);
    const apiAsset = apiAssets.get(name);
    if (
      !apiAsset ||
      apiAsset.state !== "uploaded" ||
      apiAsset.size !== result.size ||
      apiAsset.digest !== `sha256:${result.sha256}`
    ) {
      throw new Error(`GitHub Release API metadata does not match downloaded bytes: ${name}`);
    }
    if (result.size !== local.size) {
      throw new Error(`Remote release size does not match local artifact: ${name}`);
    }
    if (result.sha512 !== local.sha512) {
      throw new Error(`Remote release SHA-512 does not match local artifact: ${name}`);
    }
    remote[name] = result;
  }

  const remoteManifestBytes = remote[names.manifest].bytes;
  const manifest = parse(remoteManifestBytes.toString("utf8"));
  if (
    manifest?.version !== expectedVersion ||
    manifest?.path !== names.zip ||
    manifest?.files?.length !== 1 ||
    manifest.files[0]?.url !== names.zip
  ) {
    throw new Error("Remote updater manifest does not describe the canonical macOS arm64 ZIP.");
  }
  if (
    manifest.sha512 !== remote[names.zip].sha512 ||
    manifest.files[0]?.sha512 !== remote[names.zip].sha512 ||
    manifest.files[0]?.size !== remote[names.zip].size
  ) {
    throw new Error("Remote updater manifest digest or size does not match the downloaded ZIP.");
  }
  if (remote[names.zipBlockmap].size === 0) {
    throw new Error("Remote updater blockmap is empty.");
  }

  return {
    version: expectedVersion,
    baseUrl,
    latestTag: latest.tag_name,
    primaryArtifact: localManifest.primaryArtifact,
    assets: Object.fromEntries(expectedNames.map((name) => [name, {
      size: remote[name].size,
      sha256: remote[name].sha256,
      sha512: remote[name].sha512,
    }])),
  };
}

async function digestResponse(response, name) {
  const sha256 = createHash("sha256");
  const sha512 = createHash("sha512");
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    const bytes = Buffer.from(chunk);
    sha256.update(bytes);
    sha512.update(bytes);
    size += bytes.byteLength;
    if (name === "latest-mac.yml") chunks.push(bytes);
  }
  const declared = response.headers.get("content-length");
  if (declared !== null && Number(declared) !== size) {
    throw new Error(`Remote Content-Length does not match downloaded bytes: ${name}`);
  }
  return {
    size,
    sha256: sha256.digest("hex"),
    sha512: sha512.digest("base64"),
    bytes: Buffer.concat(chunks),
  };
}

async function digestFile(path) {
  const hash = createHash("sha512");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return { size: statSync(path).size, sha512: hash.digest("base64") };
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath && pathToFileURL(invokedPath).href === import.meta.url) {
  const expectedVersion = process.argv[2];
  if (!expectedVersion) {
    throw new Error("Usage: verify-remote-release.mjs <version> [output-dir] [base-url]");
  }
  const outputDir = resolve(process.argv[3] ?? join(process.cwd(), "release", "electron"));
  const baseUrl = process.argv[4];
  const evidence = await verifyRemoteRelease({
    outputDir,
    expectedVersion,
    ...(baseUrl ? { baseUrl } : {}),
  });
  console.log(JSON.stringify(evidence, null, 2));
}
