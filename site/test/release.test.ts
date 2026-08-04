import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { CHANGELOG } from "../lib/changelog";
import { DMG, RELEASE, VERSION } from "../lib/config";

const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { version: string };

describe("public release contract", () => {
  test("points every current release surface at the canonical Electron artifact", () => {
    assert.equal(VERSION, "0.2.5");
    assert.equal(packageJson.version, VERSION);
    assert.equal(RELEASE, "https://github.com/celados/markd/releases/tag/v0.2.5");
    assert.equal(
      DMG,
      "https://github.com/celados/markd/releases/download/v0.2.5/Markd-0.2.5-mac-arm64.dmg",
    );
    assert.equal(CHANGELOG[0]?.version, VERSION);
    assert.equal(CHANGELOG[0]?.releaseUrl, RELEASE);
    assert.equal(CHANGELOG.filter((entry) => entry.version === VERSION).length, 1);
  });
});
