import { describe, expect, test } from "vitest";
import { decideExternalNoteChange } from "../src/lib/editor-conflict";

describe("external Note conflict policy", () => {
  test("ignores an unchanged disk snapshot", () => {
    expect(
      decideExternalNoteChange({
        disk: "same",
        lastSaved: "same",
        dirty: false,
      }),
    ).toBe("unchanged");
  });

  test("reloads a clean editor from a changed disk snapshot", () => {
    expect(
      decideExternalNoteChange({
        disk: "external",
        lastSaved: "local",
        dirty: false,
      }),
    ).toBe("reload");
  });

  test("keeps a dirty editor when disk changed", () => {
    expect(
      decideExternalNoteChange({
        disk: "external",
        lastSaved: "local",
        dirty: true,
      }),
    ).toBe("keep-local");
  });
});
