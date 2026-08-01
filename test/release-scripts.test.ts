import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

const projectRoot = join(import.meta.dirname, "..");
const projectVersion = JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf8")).version;
const tempDirs: string[] = [];

afterEach(() => {
  for (const path of tempDirs.splice(0)) rmSync(path, { recursive: true, force: true });
});

function run(args: string[]) {
  return spawnSync(args[0], args.slice(1), {
    cwd: projectRoot,
    encoding: "utf8",
  });
}

describe("release script validation", () => {
  test("accepts the synchronized project version", () => {
    const result = run(["node", "scripts/verify-release-version.js", projectVersion]);
    expect(result.status).toBe(0);
  });

  test("rejects a mismatched project version", () => {
    const result = run(["node", "scripts/verify-release-version.js", "9.9.9"]);
    expect(result.status).not.toBe(0);
  });

  test("validates updater version, type, URL, and signature", () => {
    const dir = mkdtempSync(join(tmpdir(), "markd-manifest-test-"));
    tempDirs.push(dir);
    const manifestPath = join(dir, "latest.json");
    writeFileSync(
      manifestPath,
      JSON.stringify({
        version: projectVersion,
        notes: "New release",
        pub_date: new Date().toISOString(),
        release_type: "feature",
        platforms: {
          "darwin-aarch64": {
            signature: "signed",
            url: `https://github.com/celados/markd/releases/download/v${projectVersion}/Markd.app.tar.gz`,
          },
        },
      }),
    );

    const result = run([
      "node",
      "scripts/verify-update-manifest.js",
      manifestPath,
      projectVersion,
      "feature",
    ]);
    expect(result.status).toBe(0);
  });

  test("rejects stale updater metadata", () => {
    const dir = mkdtempSync(join(tmpdir(), "markd-manifest-test-"));
    tempDirs.push(dir);
    const manifestPath = join(dir, "latest.json");
    writeFileSync(
      manifestPath,
      JSON.stringify({
        version: "0.0.0",
        notes: "Old release",
        pub_date: new Date().toISOString(),
        release_type: "fix",
        platforms: {},
      }),
    );

    const result = run([
      "node",
      "scripts/verify-update-manifest.js",
      manifestPath,
      projectVersion,
      "feature",
    ]);
    expect(result.status).not.toBe(0);
  });
});
