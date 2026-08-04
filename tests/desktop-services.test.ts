import { afterEach, describe, expect, test, vi } from "vitest";
import {
  captureDesktop,
  cloudDesktop,
  updatesDesktop,
} from "../src/lib/desktop-services";
import { DesktopError, type RiffleDesktop } from "../src/lib/desktop";

afterEach(() => {
  Reflect.deleteProperty(globalThis, "window");
});

describe("desktop capability services", () => {
  test("reports a missing desktop without leaking a TypeError", () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {},
    });
    expect(() => cloudDesktop.plansUrl()).toThrow(
      expect.objectContaining<Partial<DesktopError>>({ kind: "DESKTOP_UNAVAILABLE" }),
    );
  });

  test("reports main-only capabilities as invalid in Quick Capture", () => {
    installWindow({
      app: { windowKind: "quick-capture" },
      capture: {},
    });

    expect(() => cloudDesktop.plansUrl()).toThrow(
      expect.objectContaining<Partial<DesktopError>>({ kind: "INVALID_WINDOW" }),
    );
    expect(() => updatesDesktop.check()).toThrow(
      expect.objectContaining<Partial<DesktopError>>({ kind: "INVALID_WINDOW" }),
    );
  });

  test("owns all four Quick Capture operations", async () => {
    const open = vi.fn(async () => success(null));
    const close = vi.fn(async () => success(null));
    const create = vi.fn(async () => success({ rel: "Inbox.md", snapshot: snapshot() }));
    const append = vi.fn(async () => success({ rel: "Inbox.md", snapshot: snapshot() }));
    installWindow({
      app: { windowKind: "quick-capture" },
      capture: { open, close, create, append },
    });

    await expect(captureDesktop.open()).resolves.toBeNull();
    await expect(captureDesktop.close()).resolves.toBeNull();
    await expect(captureDesktop.create("Inbox", "first")).resolves.toEqual(
      expect.objectContaining({ rel: "Inbox.md" }),
    );
    await expect(captureDesktop.append("Inbox.md", "second")).resolves.toEqual(
      expect.objectContaining({ rel: "Inbox.md" }),
    );
  });
});

function installWindow(riffle: {
  app: { windowKind: "main" | "quick-capture" };
  capture: Record<string, unknown>;
}): void {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { riffle: riffle as unknown as RiffleDesktop },
  });
}

function success<T>(value: T) {
  return { ok: true as const, value };
}

function snapshot() {
  return {
    root: "/tmp/vault",
    name: "vault",
    tree: [],
    theme: "system" as const,
  };
}
