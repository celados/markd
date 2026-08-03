import { describe, expect, test } from "vitest";
import * as v from "valibot";
import {
  controlRequestSchema,
  desktopErrorSchema,
  engineMessageSchema,
  engineRequestSchema,
  validateResponseValue,
} from "../electron/bridge-contract";
import { DesktopError, unwrapDesktopResult } from "../src/lib/desktop";

describe("Electron bridge contract", () => {
  test("accepts only the empty engine startup operation", () => {
    expect(
      v.safeParse(engineRequestSchema, {
        type: "request",
        id: "operation-1",
        method: "vault.startup",
        params: null,
      }).success,
    ).toBe(true);
    expect(
      v.safeParse(engineRequestSchema, {
        type: "request",
        id: "operation-2",
        method: "vault.startup",
        params: { path: "/tmp/vault" },
      }).success,
    ).toBe(false);
    expect(
      v.safeParse(engineRequestSchema, {
        type: "request",
        id: "operation-3",
        method: "raw.invoke",
        params: null,
      }).success,
    ).toBe(false);
  });

  test("validates native control parameters by semantic method", () => {
    expect(
      v.safeParse(controlRequestSchema, {
        type: "request",
        id: "operation-1",
        method: "updates.install",
        params: { id: "update-1" },
      }).success,
    ).toBe(true);
    expect(
      v.safeParse(controlRequestSchema, {
        type: "request",
        id: "operation-2",
        method: "updates.install",
        params: { id: "" },
      }).success,
    ).toBe(false);
  });

  test("rejects malformed engine messages and response values", () => {
    expect(
      v.safeParse(engineMessageSchema, {
        type: "response",
        id: "operation-1",
        epoch: 1,
        ok: false,
        error: { message: "No vault" },
      }).success,
    ).toBe(false);
    expect(validateResponseValue("vault.startup", null)).toBe(true);
    expect(validateResponseValue("vault.startup", { root: "/tmp" })).toBe(false);
  });

  test("keeps expected failures as tagged data until the renderer boundary", async () => {
    const data = v.parse(desktopErrorSchema, {
      kind: "ENGINE_UNAVAILABLE",
      message: "Markd Engine is unavailable.",
    });

    await expect(
      unwrapDesktopResult(Promise.resolve({ ok: false, error: data })),
    ).rejects.toEqual(
      expect.objectContaining({
        name: "DesktopError",
        kind: "ENGINE_UNAVAILABLE",
        message: "Markd Engine is unavailable.",
      }),
    );
    await unwrapDesktopResult(Promise.resolve({ ok: false, error: data })).catch(
      (error: unknown) => expect(error).toBeInstanceOf(DesktopError),
    );
  });
});
