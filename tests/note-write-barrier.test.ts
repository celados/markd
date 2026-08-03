import { describe, expect, test } from "vitest";
import { flushNoteWrites, registerNoteWriteFlush } from "../src/lib/note-write-barrier";

describe("Note write barrier", () => {
  test("awaits every registered editor and propagates a failed flush", async () => {
    const calls: string[] = [];
    const unregisterFirst = registerNoteWriteFlush(async () => {
      await Promise.resolve();
      calls.push("first");
    });
    const failure = new Error("save conflict");
    const unregisterSecond = registerNoteWriteFlush(async () => {
      calls.push("second");
      throw failure;
    });
    try {
      await expect(flushNoteWrites()).rejects.toBe(failure);
      expect(calls).toEqual(["second", "first"]);
    } finally {
      unregisterFirst();
      unregisterSecond();
    }
    await expect(flushNoteWrites()).resolves.toBeUndefined();
  });
});
