import { describe, expect, test } from "vitest";
import { SerialNoteWrites } from "../src/lib/serial-note-writes";

describe("serial Note writes", () => {
  test("preserves an append that lands during the first of consecutive autosaves", async () => {
    let disk = "base";
    let releaseFirst!: () => void;
    const firstStarted = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let calls = 0;
    const writes = new SerialNoteWrites(disk);
    const write = async (desired: string, expected: string) => {
      calls += 1;
      if (calls === 1) {
        await firstStarted;
        disk = `${disk}\ncaptured`;
      }
      const appended = disk === expected ? "" : disk.slice(expected.length);
      disk = desired.endsWith(appended) ? desired : `${desired}${appended}`;
      return disk;
    };

    const first = writes.save("first edit", write);
    const second = writes.save("second edit", write);
    releaseFirst();

    await expect(Promise.all([first, second])).resolves.toEqual([
      { desired: "first edit", committed: "first edit\ncaptured" },
      {
        desired: "second edit\ncaptured",
        committed: "second edit\ncaptured",
      },
    ]);
    expect(disk).toBe("second edit\ncaptured");
  });
});
