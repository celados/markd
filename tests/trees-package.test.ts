import { execFileSync } from "node:child_process";
import { describe, expect, test } from "vitest";

describe("@pierre/trees Vanilla adoption gate", () => {
  test("pins beta.6 without installing or loading React", () => {
    const output = execFileSync(process.execPath, ["scripts/verify-trees-vanilla.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });

    expect(JSON.parse(output)).toEqual({
      package: "@pierre/trees",
      version: "1.0.0-beta.6",
      reactInstalled: false,
      reactDomInstalled: false,
      reactLoaded: false,
      reactDomLoaded: false,
    });
  });
});
