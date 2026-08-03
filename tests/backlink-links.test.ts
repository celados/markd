import { describe, expect, test } from "vitest";
import { findBacklinkMentions } from "../electron/backlink-links";

describe("Markdown backlink validation", () => {
  test("accepts real links while rejecting frontmatter, images, code, and plain text", () => {
    const markdown = [
      "---",
      "ref: '[metadata](Target.md)'",
      "---",
      "Plain Target.md text.",
      "![preview](Target.md)",
      "```md",
      "[example](Target.md)",
      "```",
      "See [the target](Target.md#details) and [[Target|its wiki alias]].",
    ].join("\n");

    expect(
      findBacklinkMentions(markdown, "Source.md", "Target.md", [
        "Source.md",
        "Target.md",
      ]),
    ).toEqual([
      {
        sourceRel: "Source.md",
        context: "See the target and its wiki alias.",
        line: 9,
        occurrence: 0,
      },
      {
        sourceRel: "Source.md",
        context: "See the target and its wiki alias.",
        line: 9,
        occurrence: 1,
      },
    ]);
  });
});
