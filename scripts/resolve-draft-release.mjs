import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function validateDraftRelease(release, expectedRepository, expectedTag) {
  const repository = parseRepository(expectedRepository);
  if (!release || typeof release !== "object") {
    throw new Error(`Draft ${expectedTag} has no authenticated release metadata.`);
  }
  if (release.tag_name !== expectedTag) {
    throw new Error(`Draft release does not own the exact tag ${expectedTag}.`);
  }
  if (release.draft !== true) {
    throw new Error(`A published release already owns ${expectedTag}.`);
  }
  if (release.prerelease !== false) {
    throw new Error(`Draft ${expectedTag} must not be a prerelease.`);
  }
  if (!Number.isSafeInteger(release.id) || release.id <= 0) {
    throw new Error(`Draft ${expectedTag} has no stable release ID.`);
  }

  const template = "{?name,label}";
  if (typeof release.upload_url !== "string" || /[\r\n]/u.test(release.upload_url)) {
    throw new Error(`Draft ${expectedTag} has no matching upload URL.`);
  }
  const rawUploadUrl = release.upload_url.endsWith(template)
    ? release.upload_url.slice(0, -template.length)
    : release.upload_url;
  if (/[{}]/u.test(rawUploadUrl)) {
    throw new Error(`Draft ${expectedTag} has no matching upload URL.`);
  }
  let uploadUrl;
  try {
    uploadUrl = new URL(rawUploadUrl);
  } catch {
    throw new Error(`Draft ${expectedTag} has no matching upload URL.`);
  }
  const expectedPath = `/repos/${repository.owner}/${repository.name}/releases/${release.id}/assets`;
  if (
    uploadUrl.protocol !== "https:" ||
    uploadUrl.hostname !== "uploads.github.com" ||
    uploadUrl.port !== "" ||
    uploadUrl.username !== "" ||
    uploadUrl.password !== "" ||
    uploadUrl.pathname !== expectedPath ||
    uploadUrl.search !== "" ||
    uploadUrl.hash !== ""
  ) {
    throw new Error(`Draft ${expectedTag} has no matching upload URL.`);
  }
  const canonicalUploadUrl = `https://uploads.github.com${expectedPath}`;
  return {
    releaseId: release.id,
    uploadUrl: canonicalUploadUrl,
    release: { ...release, upload_url: canonicalUploadUrl },
  };
}

export function resolveDraftRelease(pages, expectedRepository, expectedTag) {
  if (!Array.isArray(pages) || pages.some((page) => !Array.isArray(page))) {
    throw new Error("Authenticated release listing must be an array of pages.");
  }
  const matches = pages.flat().filter((release) => release?.tag_name === expectedTag);
  if (matches.length > 1) {
    throw new Error(`Release identity is ambiguous for ${expectedTag}.`);
  }
  if (matches.length === 0) return null;
  return validateDraftRelease(matches[0], expectedRepository, expectedTag).release;
}

function parseRepository(repository) {
  if (typeof repository !== "string") {
    throw new Error("Expected repository must use the owner/name form.");
  }
  const segments = repository.split("/");
  const hasInvalidSegment = segments.some((segment) =>
    segment === "." || segment === ".." || !/^[A-Za-z0-9_.-]+$/u.test(segment)
  );
  if (
    segments.length !== 2 ||
    hasInvalidSegment
  ) {
    throw new Error("Expected repository must use the owner/name form.");
  }
  return { owner: segments[0], name: segments[1] };
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath && pathToFileURL(invokedPath).href === import.meta.url) {
  const [command, expectedRepository, expectedTag] = process.argv.slice(2);
  if (
    !["resolve", "validate"].includes(command) ||
    !expectedRepository ||
    !expectedTag ||
    process.argv.length !== 5
  ) {
    throw new Error(
      "Usage: resolve-draft-release.mjs <resolve|validate> <owner/repo> <expected-tag>",
    );
  }
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  const parsed = JSON.parse(input);
  const result = command === "resolve"
    ? resolveDraftRelease(parsed, expectedRepository, expectedTag)
    : validateDraftRelease(parsed, expectedRepository, expectedTag);
  console.log(JSON.stringify(command === "validate" ? {
    release_id: result.releaseId,
    upload_url: result.uploadUrl,
  } : result));
}
