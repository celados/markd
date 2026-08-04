import { describe, expect, test } from "vitest";
import {
  isTrustedCloudUrl,
  isTrustedUploadUrl,
  resolveCloudConfig,
} from "../electron/cloud-config";

describe("Cloud ownership gate", () => {
  test("keeps the fork unavailable until ownership and origins are explicit", () => {
    expect(resolveCloudConfig({})).toEqual({
      ok: false,
      message:
        "Cloud publishing is unavailable because this build has not verified ownership of its Cloud API and site.",
    });
    expect(resolveCloudConfig({
      RIFFLE_CLOUD_OWNERSHIP: "verified",
      RIFFLE_CLOUD_API_BASE: "https://api.usemarkd.app",
      RIFFLE_CLOUD_SITE_ORIGIN: "https://usemarkd.app",
    })).toEqual({
      ok: false,
      message:
        "Cloud publishing is unavailable because this build has not verified ownership of its Cloud API and site.",
    });
    expect(resolveCloudConfig({
      RIFFLE_CLOUD_TEST_MODE: "1",
      RIFFLE_CLOUD_API_BASE: "https://api.example.test/path",
      RIFFLE_CLOUD_SITE_ORIGIN: "javascript:alert(1)",
    })).toEqual({
      ok: false,
      message: "Cloud publishing is unavailable because its trusted origins are invalid.",
    });
  });

  test("allows only the verified site origin for native external open", () => {
    const result = resolveCloudConfig({
      RIFFLE_CLOUD_TEST_MODE: "1",
      RIFFLE_CLOUD_API_BASE: "http://127.0.0.1:3001",
      RIFFLE_CLOUD_SITE_ORIGIN: "http://127.0.0.1:3002",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(isTrustedCloudUrl("http://127.0.0.1:3002/pricing?token=secret", result.value)).toBe(true);
    expect(isTrustedCloudUrl("http://127.0.0.1.evil.invalid/pricing", result.value)).toBe(false);
    expect(isTrustedCloudUrl("file:///etc/passwd", result.value)).toBe(false);
    expect(isTrustedUploadUrl("https://objects.example.test/upload", result.value)).toBe(true);
    expect(isTrustedUploadUrl("http://127.0.0.1:3003/upload", result.value)).toBe(true);
    expect(isTrustedUploadUrl(
      "http://127.0.0.1:3003/upload",
      { ...result.value, allowLoopbackHttp: false },
    )).toBe(false);
    expect(isTrustedUploadUrl("http://objects.example.test/upload", result.value)).toBe(false);
    expect(isTrustedUploadUrl("https://user:secret@objects.example.test/upload", result.value)).toBe(false);
    expect(isTrustedUploadUrl("file:///tmp/upload", result.value)).toBe(false);
  });
});
