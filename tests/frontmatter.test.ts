import { describe, expect, test } from "vitest";
import {
  parseFrontmatter,
  removeFrontmatterProperty,
  upsertFrontmatterProperty,
} from "../src/lib/frontmatter";

describe("frontmatter property editing", () => {
  test("creates frontmatter for a new scalar property", () => {
    expect(
      upsertFrontmatterProperty("", null, { key: "status", value: "active" }),
    ).toBe('---\nstatus: "active"\n---\n');
  });

  test("appends a property without changing unrelated YAML", () => {
    const source = "---\n# clipped data\nnested:\n  name: value\n---\n";
    expect(
      upsertFrontmatterProperty(source, null, {
        key: "type",
        value: "profile",
      }),
    ).toBe(
      '---\n# clipped data\nnested:\n  name: value\ntype: "profile"\n---\n',
    );
  });

  test("renames a scalar property into a list", () => {
    const source = "---\nstatus: active\nkeep: yes\n---\n";
    expect(
      upsertFrontmatterProperty(source, "status", {
        key: "tags",
        value: ["one", "two"],
      }),
    ).toBe('---\ntags:\n  - "one"\n  - "two"\nkeep: yes\n---\n');
  });

  test("removes only the selected property", () => {
    const source = '---\ntags:\n  - "one"\n  - "two"\nkeep: yes\n---\n';
    expect(removeFrontmatterProperty(source, "tags")).toBe(
      "---\nkeep: yes\n---\n",
    );
  });

  test("removes an empty frontmatter block with its last property", () => {
    expect(removeFrontmatterProperty('---\nstatus: "active"\n---\n', "status")).toBe(
      "",
    );
  });

  test("parses escaped values authored by the UI", () => {
    expect(parseFrontmatter('---\ntitle: "A \\"quoted\\" note"\n---\n')).toEqual([
      { key: "title", value: 'A "quoted" note' },
    ]);
  });

  test("parses folded and literal YAML block scalars as their resolved values", () => {
    expect(
      parseFrontmatter(
        "---\nsummary: >-\n  A long field value that\n  continues on another line.\nbody: |-\n  first\n  second\n---\n",
      ),
    ).toEqual([
      {
        key: "summary",
        value: "A long field value that continues on another line.",
      },
      { key: "body", value: "first\nsecond" },
    ]);
  });

  test("replaces a block scalar without leaving its continuation lines", () => {
    const source =
      "---\nsummary: >-\n  old long value\n  on two lines\nkeep: yes\n---\n";
    expect(
      upsertFrontmatterProperty(source, "summary", {
        key: "summary",
        value: "replacement",
      }),
    ).toBe('---\nsummary: "replacement"\nkeep: yes\n---\n');
  });

  test("removes a block scalar without changing unrelated YAML", () => {
    const source =
      "---\nsummary: >-\n  old long value\n  on two lines\n# keep this comment\nnested:\n  name: value\n---\n";
    expect(removeFrontmatterProperty(source, "summary")).toBe(
      "---\n# keep this comment\nnested:\n  name: value\n---\n",
    );
  });
});
