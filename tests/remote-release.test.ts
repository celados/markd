import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify } from "yaml";
import { afterEach, expect, test } from "vitest";
import { verifyRemoteRelease } from "../scripts/verify-remote-release.mjs";
import { electronArtifactNames } from "../scripts/electron-artifacts.mjs";

const scratch: string[] = [];
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) =>
    server.close((error) => error ? reject(error) : resolve()),
  )));
  await Promise.all(scratch.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

test("anonymous release readback verifies canonical assets and updater metadata", async () => {
  const fixture = await releaseFixture();
  const remote = await serve(fixture.files);

  await expect(verifyRemoteRelease({
    outputDir: fixture.outputDir,
    expectedVersion: "0.2.0",
    ...remote,
  })).resolves.toMatchObject({
    version: "0.2.0",
    latestTag: "v0.2.0",
    primaryArtifact: "Markd-0.2.0-mac-arm64.zip",
    assets: {
      "Markd-0.2.0-mac-arm64.dmg": { size: expect.any(Number), sha512: expect.any(String) },
      "Markd-0.2.0-mac-arm64.zip": { size: expect.any(Number), sha512: expect.any(String) },
      "Markd-0.2.0-mac-arm64.zip.blockmap": {
        size: expect.any(Number),
        sha512: expect.any(String),
      },
      "latest-mac.yml": { size: expect.any(Number), sha512: expect.any(String) },
    },
  });
});

test("anonymous release readback fails closed on missing or changed assets", async () => {
  const missing = await releaseFixture();
  missing.files.delete("Markd-0.2.0-mac-arm64.dmg");
  await expect(verifyRemoteRelease({
    outputDir: missing.outputDir,
    expectedVersion: "0.2.0",
    ...await serve(missing.files),
  })).rejects.toThrow(/exactly the canonical assets/u);

  const changed = await releaseFixture();
  changed.files.set("Markd-0.2.0-mac-arm64.zip", Buffer.from("changed remote ZIP"));
  await expect(verifyRemoteRelease({
    outputDir: changed.outputDir,
    expectedVersion: "0.2.0",
    ...await serve(changed.files),
  })).rejects.toThrow(/size does not match|SHA-512 does not match/u);

  const extra = await releaseFixture();
  extra.files.set("Markd-0.1.9-mac-arm64.zip", Buffer.from("stale"));
  await expect(verifyRemoteRelease({
    outputDir: extra.outputDir,
    expectedVersion: "0.2.0",
    ...await serve(extra.files),
  })).rejects.toThrow(/exactly the canonical assets/u);
});

test("anonymous release readback requires latest to resolve to the published stable tag", async () => {
  const fixture = await releaseFixture();
  await expect(verifyRemoteRelease({
    outputDir: fixture.outputDir,
    expectedVersion: "0.2.0",
    ...await serve(fixture.files, "v0.1.9"),
  })).rejects.toThrow(/latest stable release must resolve/u);
});

async function releaseFixture() {
  const outputDir = await mkdtemp(join(tmpdir(), "markd-remote-release-"));
  scratch.push(outputDir);
  const names = electronArtifactNames("0.2.0", "arm64");
  const zip = Buffer.from("signed Electron ZIP fixture");
  const sha512 = createHash("sha512").update(zip).digest("base64");
  const files = new Map<string, Buffer>([
    [names.dmg, Buffer.from("notarized DMG fixture")],
    [names.zip, zip],
    [names.zipBlockmap, Buffer.from("blockmap fixture")],
    [names.manifest, Buffer.from(stringify({
      version: "0.2.0",
      files: [{ url: names.zip, sha512, size: zip.byteLength }],
      path: names.zip,
      sha512,
      releaseDate: "2026-08-04T00:00:00.000Z",
    }))],
  ]);
  await Promise.all([...files].map(([name, content]) => writeFile(join(outputDir, name), content)));
  return { outputDir, files };
}

async function serve(files: Map<string, Buffer>, latestTag = "v0.2.0") {
  const server = createServer((request, response) => {
    if (request.url === "/api" || request.url === "/latest") {
      const assets = [...files].map(([name, content]) => ({
        name,
        state: "uploaded",
        size: content.byteLength,
        digest: `sha256:${createHash("sha256").update(content).digest("hex")}`,
      }));
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        tag_name: request.url === "/latest" ? latestTag : "v0.2.0",
        draft: false,
        prerelease: false,
        assets,
      }));
      return;
    }
    const name = decodeURIComponent((request.url ?? "").split("/").pop() ?? "");
    const content = files.get(name);
    if (!content) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "content-length": String(content.byteLength) });
    response.end(content);
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { baseUrl: origin, apiUrl: `${origin}/api`, latestApiUrl: `${origin}/latest` };
}
