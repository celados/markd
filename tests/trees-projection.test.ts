import { describe, expect, test } from "vitest";
import {
  createTreesProjection,
  diffTreesProjection,
  fromTreesPath,
} from "../src/lib/trees-projection";

describe("Vault tree to Trees projection", () => {
  test("projects canonical paths without duplicating disk state", () => {
    const projection = createTreesProjection(
      [
        {
          name: "Empty",
          rel: "Empty",
          kind: "folder",
          modifiedMs: 0,
          children: [],
        },
        {
          name: "Projects",
          rel: "Projects",
          kind: "folder",
          modifiedMs: 0,
          children: [
            {
              name: "Alpha.md",
              rel: "Projects/Alpha.md",
              kind: "note",
              modifiedMs: 1,
            },
          ],
        },
        {
          name: "README.md",
          rel: "README.md",
          kind: "note",
          modifiedMs: 2,
        },
      ],
      new Set(["Projects"]),
    );

    expect(projection.paths).toEqual(["Empty/", "README.md"]);
    expect(projection.byRel.get("Empty")?.kind).toBe("folder");
    expect(fromTreesPath("Empty/")).toBe("Empty");
  });

  test("turns external canonical changes into incremental model operations", () => {
    const previous = createTreesProjection([
      {
        name: "Archive",
        rel: "Archive",
        kind: "folder",
        modifiedMs: 0,
        children: [],
      },
      { name: "README.md", rel: "README.md", kind: "note", modifiedMs: 1 },
    ]);
    const next = createTreesProjection([
      {
        name: "Archive",
        rel: "Archive",
        kind: "folder",
        modifiedMs: 0,
        children: [
          {
            name: "Later.md",
            rel: "Archive/Later.md",
            kind: "note",
            modifiedMs: 2,
          },
        ],
      },
    ]);

    expect(diffTreesProjection(previous, next)).toEqual([
      { type: "remove", path: "README.md" },
      { type: "add", path: "Archive/Later.md" },
    ]);
  });
});
