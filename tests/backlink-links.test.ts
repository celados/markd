import { describe, expect, test } from "vitest";
import { findBacklinkMentions } from "../electron/backlink-links";

describe("Markdown backlink validation", () => {
  test("accepts real links while rejecting non-Markdown mentions", () => {
    const markdown = [
      "---",
      "ref: '[metadata](Target.md)'",
      "---",
      "Plain Target.md text.",
      "![preview](Target.md)",
      "```md",
      "[example](Target.md)",
      "```",
      "Inline `[example](Target.md)` is code, not a link.",
      "<!-- [hidden](Target.md) -->",
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
        line: 11,
        occurrence: 0,
      },
      {
        sourceRel: "Source.md",
        context: "See the target and its wiki alias.",
        line: 11,
        occurrence: 1,
      },
    ]);
  });

  test("matches percent-encoded path separators without corrupting malformed escapes", () => {
    expect(
      findBacklinkMentions(
        "[roadmap](Projects%2FRoadmap.md)",
        "Source.md",
        "Projects/Roadmap.md",
        ["Source.md", "Projects/Roadmap.md"],
      ),
    ).toHaveLength(1);
    expect(
      findBacklinkMentions(
        "[odd](notes/%aé.md)",
        "Source.md",
        "notes/%aé.md",
        ["Source.md", "notes/%aé.md"],
      ),
    ).toHaveLength(1);
    expect(
      findBacklinkMentions(
        "[invalid](notes/%E9.md)",
        "Source.md",
        "notes/%E9.md",
        ["Source.md", "notes/%E9.md"],
      ),
    ).toHaveLength(1);
    expect(
      findBacklinkMentions(
        "[truncated](notes/%C3.md)",
        "Source.md",
        "notes/%C3.md",
        ["Source.md", "notes/%C3.md"],
      ),
    ).toHaveLength(1);
    expect(
      findBacklinkMentions(
        "[valid](notes/%C3%A9.md)",
        "Source.md",
        "notes/é.md",
        ["Source.md", "notes/é.md"],
      ),
    ).toHaveLength(1);
    expect(
      findBacklinkMentions(
        "[encoded letter](%54arget.md)",
        "Source.md",
        "Target.md",
        ["Source.md", "Target.md"],
      ),
    ).toHaveLength(1);
  });
});
