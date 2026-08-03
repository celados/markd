import { describe, expect, test } from "vitest";
import { resolveE2eUpdateChannel } from "../electron/update-channel";

describe("resolveE2eUpdateChannel", () => {
  test("allows only an explicit background loopback channel", () => {
    expect(resolveE2eUpdateChannel("http://127.0.0.1:4178/releases/", true))
      .toBe("http://127.0.0.1:4178/releases/");
    expect(resolveE2eUpdateChannel("http://localhost:4178", false)).toBeNull();
    expect(resolveE2eUpdateChannel(undefined, true)).toBeNull();
  });

  test.each([
    "https://github.com/celados/markd/releases/",
    "http://192.168.1.10/releases/",
    "file:///tmp/releases/",
  ])("rejects a non-loopback provider override: %s", (url) => {
    expect(() => resolveE2eUpdateChannel(url, true)).toThrow(/loopback/u);
  });
});
