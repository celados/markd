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

  test("recomputes a Property mutation after an accepted source changes", async () => {
    let disk = "status: draft\noriginal body";
    let writes = 0;
    const queue = new SerialNoteWrites(disk);

    const result = await queue.mutateLatest(
      (source) => source.replace("status: draft", "status: reviewed"),
      async () => disk,
      async (desired, expected) => {
        writes += 1;
        if (writes === 1) {
          disk = "status: draft\nagent body";
          throw { kind: "STALE_NOTE_WRITE" };
        }
        expect(expected).toBe("status: draft\nagent body");
        disk = desired;
        return disk;
      },
    );

    expect(result).toEqual({
      desired: "status: reviewed\nagent body",
      committed: "status: reviewed\nagent body",
    });
    expect(disk).toBe("status: reviewed\nagent body");
  });

  test("bounds a stale Property mutation to one fresh retry", async () => {
    let reads = 0;
    let writes = 0;
    const queue = new SerialNoteWrites("status: draft\nbody");

    await expect(queue.mutateLatest(
      (source) => source.replace("draft", "reviewed"),
      async () => {
        reads += 1;
        return `status: draft\nbody ${reads}`;
      },
      async () => {
        writes += 1;
        throw { kind: "STALE_NOTE_WRITE" };
      },
    )).rejects.toEqual({ kind: "STALE_NOTE_WRITE" });
    expect({ reads, writes }).toEqual({ reads: 2, writes: 2 });
  });
});
