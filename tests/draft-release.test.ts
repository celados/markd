import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify } from "yaml";
import { afterEach, expect, test } from "vitest";
import { electronArtifactNames } from "../scripts/electron-artifacts.mjs";
import { verifyDraftRelease } from "../scripts/verify-draft-release.mjs";

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
