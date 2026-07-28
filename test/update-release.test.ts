import { describe, expect, test } from "vitest";
import { shouldShowReleaseNotes } from "../src/lib/updateRelease.ts";

describe("update release classification", () => {
  test("installs patch releases directly", () => {
    expect(
      shouldShowReleaseNotes({ currentVersion: "0.1.5", version: "0.1.6" }),
    ).toBe(false);
  });

  test("shows notes for minor and major releases", () => {
    expect(
      shouldShowReleaseNotes({ currentVersion: "0.1.5", version: "0.2.0" }),
    ).toBe(true);
    expect(
      shouldShowReleaseNotes({ currentVersion: "0.9.0", version: "1.0.0" }),
    ).toBe(true);
  });

  test("respects an explicit manifest release type", () => {
    expect(
      shouldShowReleaseNotes({
        currentVersion: "0.1.5",
        version: "0.1.6",
        rawJson: { release_type: "feature" },
      }),
    ).toBe(true);
    expect(
      shouldShowReleaseNotes({
        currentVersion: "0.1.5",
        version: "0.2.0",
        rawJson: { release_type: "fix" },
      }),
    ).toBe(false);
  });
});
