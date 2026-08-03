import { describe, expect, test } from "vitest";
import * as v from "valibot";
import {
  controlRequestSchema,
  desktopErrorSchema,
  engineMessageSchema,
  engineConnectSchema,
  engineRequestSchema,
  nativeRequestSchema,
  nativeResponseSchema,
  validateResponseValue,
} from "../electron/bridge-contract";
import { DesktopError, unwrapDesktopResult } from "../src/lib/desktop";
import { createEngineGenerationTerminal } from "../electron/engine-generation";

describe("Electron bridge contract", () => {
  test("accepts the frozen Vault Engine operations", () => {
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
        id: "capture-empty",
        method: "capture.append",
        params: { rel: "inbox.md", content: "  \n" },
      }).success,
    ).toBe(false);
    expect(
      v.safeParse(engineRequestSchema, {
        type: "request",
        id: "capture-append",
        method: "capture.append",
        params: { rel: "inbox.md", content: "A captured thought" },
      }).success,
    ).toBe(true);
    expect(
      v.safeParse(engineRequestSchema, {
        type: "request",
        id: "operation-asset",
        method: "vault.asset.save",
        params: { data: "aGVsbG8=", extension: "png" },
      }).success,
    ).toBe(true);
    expect(
      v.safeParse(engineRequestSchema, {
        type: "request",
        id: "operation-export",
        method: "vault.note.export",
        params: { rel: "notes/idea.md", content: "live body" },
      }).success,
    ).toBe(true);
    expect(
      v.safeParse(engineRequestSchema, {
        type: "request",
        id: "operation-pin",
        method: "vault.pins.add",
        params: { rel: "notes/idea.md" },
      }).success,
    ).toBe(true);
    expect(
      v.safeParse(engineRequestSchema, {
        type: "request",
        id: "operation-path",
        method: "vault.note.path",
        params: { rel: "notes/idea.md" },
      }).success,
    ).toBe(true);
    expect(
      v.safeParse(engineRequestSchema, {
        type: "request",
        id: "operation-empty-pin",
        method: "vault.pins.add",
        params: { rel: "" },
      }).success,
    ).toBe(false);
    expect(
      v.safeParse(engineRequestSchema, {
        type: "request",
        id: "operation-collections",
        method: "collections.todos.change",
        params: { id: "todo-1", change: { type: "toggle" } },
      }).success,
    ).toBe(true);
    expect(
      v.safeParse(engineRequestSchema, {
        type: "request",
        id: "operation-invalid-collections",
        method: "collections.todos.change",
        params: { id: "todo-1", change: { type: "unknown" } },
      }).success,
    ).toBe(false);
    expect(
      v.safeParse(engineRequestSchema, {
        type: "request",
        id: "operation-2",
        method: "vault.open",
        params: { root: "/tmp/vault", create: false },
      }).success,
    ).toBe(true);
    expect(
      v.safeParse(engineRequestSchema, {
        type: "request",
        id: "operation-3",
        method: "vault.note.write",
        params: {
          rel: "notes/idea.md",
          content: "hello",
          expectedContent: "before",
        },
      }).success,
    ).toBe(true);
    expect(
      v.safeParse(engineRequestSchema, {
        type: "request",
        id: "operation-4",
        method: "raw.invoke",
        params: null,
      }).success,
    ).toBe(false);
  });

  test("validates the utility-to-main native content operations", () => {
    expect(
      v.safeParse(nativeRequestSchema, {
        type: "native-request",
        id: "native-asset-root",
        epoch: 1,
        method: "asset-root.stage",
        root: "/vault",
        assetRoot: "/vault/.markd/assets",
      }).success,
    ).toBe(true);
    expect(
      v.safeParse(nativeRequestSchema, {
        type: "native-request",
        id: "native-asset-rollback",
        epoch: 1,
        method: "asset-root.rollback",
        stageId: "stage-1",
      }).success,
    ).toBe(true);
    expect(
      v.safeParse(nativeRequestSchema, {
        type: "native-request",
        id: "native-asset-commit",
        epoch: 1,
        method: "asset-root.commit",
        stageId: "stage-1",
      }).success,
    ).toBe(true);
    expect(
      v.safeParse(nativeRequestSchema, {
        type: "native-request",
        id: "native-export",
        epoch: 1,
        method: "export.save",
        windowKind: "main",
        suggestedName: "Note.md",
        content: "body",
      }).success,
    ).toBe(true);
    expect(
      v.safeParse(nativeRequestSchema, {
        type: "native-request",
        id: "native-export-quick",
        epoch: 1,
        method: "export.save",
        windowKind: "quick-capture",
        suggestedName: "Note.md",
        content: "body",
      }).success,
    ).toBe(false);
    expect(
      v.safeParse(nativeRequestSchema, {
        type: "native-request",
        id: "native-export-invalid",
        epoch: 1,
        method: "export.save",
        windowKind: "main",
        suggestedName: "../Outside.md",
        content: "body",
      }).success,
    ).toBe(false);
    expect(
      v.safeParse(nativeResponseSchema, {
        type: "native-response",
        id: "native-export",
        epoch: 1,
        ok: true,
        value: "/tmp/Note.md",
      }).success,
    ).toBe(true);
  });

  test("binds every utility port to a desktop window kind", () => {
    expect(
      v.safeParse(engineConnectSchema, {
        type: "connect",
        epoch: 1,
        configDir: "/tmp/config",
        windowKind: "main",
      }).success,
    ).toBe(true);
    expect(
      v.safeParse(engineConnectSchema, {
        type: "connect",
        epoch: 1,
        configDir: "/tmp/config",
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
    expect(
      v.safeParse(controlRequestSchema, {
        type: "request",
        id: "operation-3",
        method: "dialog.chooseVault",
        params: null,
      }).success,
    ).toBe(true);
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
    expect(validateResponseValue("vault.note.read", "# note")).toBe(true);
    expect(validateResponseValue("vault.note.read", null)).toBe(false);
    expect(
      validateResponseValue("vault.pins.list", {
        pins: ["notes/idea.md"],
        stale: ["gone.md"],
      }),
    ).toBe(true);
    expect(validateResponseValue("vault.note.path", "/tmp/vault/idea.md")).toBe(true);
    expect(validateResponseValue("vault.asset.save", ".markd/assets/id.png")).toBe(true);
    expect(validateResponseValue("vault.note.export", null)).toBe(true);
    expect(validateResponseValue("vault.note.export", "/tmp/Note.md")).toBe(true);
    expect(
      validateResponseValue("collections.snapshot", {
        todos: [],
        todoTags: [],
        bookmarks: [],
        bookmarkTags: [],
      }),
    ).toBe(true);
    expect(validateResponseValue("collections.snapshot", { todos: {} })).toBe(false);
    expect(
      validateResponseValue("capture.append", {
        rel: "inbox.md",
        snapshot: {
          root: "/tmp/vault",
          name: "vault",
          tree: [],
          theme: "system",
        },
      }),
    ).toBe(true);
  });

  test("keeps expected failures as tagged data until the renderer boundary", async () => {
    const data = v.parse(desktopErrorSchema, {
      kind: "ENGINE_UNAVAILABLE",
      message: "Markd Engine is unavailable.",
    });

    await expect(unwrapDesktopResult(Promise.resolve({ ok: false, error: data }))).rejects.toEqual(
      expect.objectContaining({
        name: "DesktopError",
        kind: "ENGINE_UNAVAILABLE",
        message: "Markd Engine is unavailable.",
      }),
    );
    await unwrapDesktopResult(Promise.resolve({ ok: false, error: data })).catch((error: unknown) =>
      expect(error).toBeInstanceOf(DesktopError),
    );
  });

  test("an engine generation reaches its terminal transition only once", () => {
    const restarts: string[] = [];
    const terminal = createEngineGenerationTerminal((message) => {
      restarts.push(message);
    });

    expect(terminal.terminate("fatal error")).toBe(true);
    expect(terminal.terminate("exit after fatal error")).toBe(false);
    expect(terminal.isTerminal()).toBe(true);
    expect(restarts).toEqual(["fatal error"]);
  });
});
