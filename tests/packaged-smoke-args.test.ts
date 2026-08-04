import { describe, expect, test } from "vitest";
import { parsePackagedAppArgs } from "../scripts/run-packaged-smoke.mjs";

describe("packaged smoke CLI arguments", () => {
  test.each([
    [[], null],
    [["--"], null],
    [["/Applications/Riffle.app"], "/Applications/Riffle.app"],
    [["--", "/Applications/Riffle.app"], "/Applications/Riffle.app"],
  ])("parses %j", (args, expected) => {
    expect(parsePackagedAppArgs(args)).toBe(expected);
  });

  test.each([
    [["one.app", "two.app"]],
    [["--", "one.app", "extra"]],
    [["--", "--"]],
    [[""]],
    [["--", ""]],
  ])("rejects ambiguous arguments %j", (args) => {
    expect(() => parsePackagedAppArgs(args)).toThrow(/Usage:/u);
  });
});
