import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify } from "yaml";
import { afterEach, expect, test } from "vitest";
import { electronArtifactNames } from "../scripts/electron-artifacts.mjs";
import { verifyDraftRelease } from "../scripts/verify-draft-release.mjs";
import {
  resolveDraftRelease,
  validateDraftRelease,
} from "../scripts/resolve-draft-release.mjs";

const scratch: string[] = [];

afterEach(async () => {
  await Promise.all(scratch.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

test("authenticated draft readback requires exact canonical bytes and API digests", async () => {
  const fixture = await draftFixture();
  await expect(verifyDraftRelease(fixture.options)).resolves.toMatchObject({
    version: "0.2.0",
    assets: {
      "Markd-0.2.0-mac-arm64.zip": { sha256: expect.any(String), sha512: expect.any(String) },
    },
  });
});

test("authenticated draft readback rejects changed bytes and stale assets", async () => {
  const changed = await draftFixture();
  await writeFile(join(changed.readbackDir, changed.names.zip), "changed");
  await expect(verifyDraftRelease(changed.options)).rejects.toThrow(/does not match local bytes/u);

  const stale = await draftFixture();
  await writeFile(join(stale.readbackDir, "stale.zip"), "stale");
  await expect(verifyDraftRelease(stale.options)).rejects.toThrow(/exactly the canonical/u);
});

test("draft identity resolves exactly one authenticated draft by tag", () => {
  const draft = releaseIdentity({ id: 42, tag_name: "v0.2.5" });
  expect(resolveDraftRelease(
    [[releaseIdentity({ id: 7, tag_name: "v0.1.9", draft: false })], [draft]],
    "celados/markd",
    "v0.2.5",
  )).toMatchObject({
    id: 42,
    upload_url: "https://uploads.github.com/repos/celados/markd/releases/42/assets",
  });
  expect(resolveDraftRelease([[]], "celados/markd", "v0.2.5")).toBeNull();
});

test("draft identity rejects ambiguous and public tag matches", () => {
  const first = releaseIdentity({ id: 42, tag_name: "v0.2.5" });
  const second = releaseIdentity({ id: 43, tag_name: "v0.2.5" });
  expect(() => resolveDraftRelease(
    [[first, second]],
    "celados/markd",
    "v0.2.5",
  )).toThrow(/ambiguous/u);
  expect(() => resolveDraftRelease([[
    releaseIdentity({ id: 42, tag_name: "v0.2.5", draft: false }),
  ]], "celados/markd", "v0.2.5")).toThrow(/published release/u);
});

test("draft validator returns a canonical ID-bound upload URL", () => {
  expect(validateDraftRelease(
    releaseIdentity({}),
    "celados/markd",
    "v0.2.5",
  )).toEqual({
    releaseId: 42,
    uploadUrl: "https://uploads.github.com/repos/celados/markd/releases/42/assets",
    release: expect.objectContaining({
      id: 42,
      upload_url: "https://uploads.github.com/repos/celados/markd/releases/42/assets",
    }),
  });
});

test.each([
  ["http", "http://uploads.github.com/repos/celados/markd/releases/42/assets"],
  ["other repo", "https://uploads.github.com/repos/other/markd/releases/42/assets"],
  ["prefix path", "https://uploads.github.com/prefix/repos/celados/markd/releases/42/assets"],
  ["query", "https://uploads.github.com/repos/celados/markd/releases/42/assets?stale=1"],
  ["hash", "https://uploads.github.com/repos/celados/markd/releases/42/assets#stale"],
  ["newline", "https://uploads.github.com/repos/celados/markd/releases/42/assets\nignored"],
  ["template residue", "https://uploads.github.com/repos/celados/markd/releases/42/assets{?stale}"],
])("draft validator rejects %s upload URLs", (_name, uploadUrl) => {
  expect(() => validateDraftRelease(
    releaseIdentity({ upload_url: uploadUrl }),
    "celados/markd",
    "v0.2.5",
  )).toThrow(/upload URL/u);
});

test.each([
  ["unsafe ID", { id: Number.MAX_SAFE_INTEGER + 1 }],
  ["zero ID", { id: 0 }],
  ["wrong tag", { tag_name: "v0.2.4" }],
  ["public", { draft: false }],
  ["prerelease", { prerelease: true }],
])("draft validator rejects %s metadata", (_name, overrides) => {
  expect(() => validateDraftRelease(
    releaseIdentity(overrides),
    "celados/markd",
    "v0.2.5",
  )).toThrow();
});

function releaseIdentity(overrides: Record<string, unknown>) {
  const id = Number(overrides.id ?? 42);
  return {
    id,
    tag_name: "v0.2.5",
    draft: true,
    prerelease: false,
    upload_url: `https://uploads.github.com/repos/celados/markd/releases/${id}/assets{?name,label}`,
    ...overrides,
  };
}

async function draftFixture() {
  const parent = await mkdtemp(join(tmpdir(), "markd-draft-release-"));
  scratch.push(parent);
  const localDir = join(parent, "local");
  const readbackDir = join(parent, "readback");
  const metadataPath = join(parent, "release.json");
  await mkdir(localDir);
  const names = electronArtifactNames("0.2.0", "arm64");
  const zip = Buffer.from("signed Electron ZIP fixture");
  const sha512 = createHash("sha512").update(zip).digest("base64");
  const contents = new Map([
    [names.dmg, Buffer.from("notarized DMG fixture")],
    [names.zip, zip],
    [names.zipBlockmap, Buffer.from("blockmap fixture")],
    [names.manifest, Buffer.from(stringify({
      version: "0.2.0",
      files: [{ url: names.zip, sha512, size: zip.byteLength }],
      path: names.zip,
      sha512,
    }))],
  ]);
  await Promise.all([...contents].map(([name, bytes]) => writeFile(join(localDir, name), bytes)));
  await cp(localDir, readbackDir, { recursive: true });
  await writeFile(metadataPath, JSON.stringify({
    tag_name: "v0.2.0",
    draft: true,
    prerelease: false,
    assets: [...contents].map(([name, bytes]) => ({
      name,
      state: "uploaded",
      size: bytes.byteLength,
      digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    })),
  }));
  return {
    localDir,
    readbackDir,
    metadataPath,
    names,
    options: { localDir, readbackDir, metadataPath, expectedVersion: "0.2.0" },
  };
}
