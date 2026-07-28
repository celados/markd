import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  noteDescription,
  publishedProperties,
  publishedPropertyType,
  stripPublishedFrontmatter,
} from "../lib/published-note";

describe("published note properties", () => {
  test("splits YAML frontmatter from rendered body", () => {
    const markdown = [
      "---",
      'status: "done"',
      "Tagged:",
      '  - "hello"',
      '  - "hi"',
      "---",
      "",
      "# Visible note",
      "",
      "Body text.",
    ].join("\n");

    assert.equal(
      stripPublishedFrontmatter(markdown),
      "# Visible note\n\nBody text.",
    );
  });

  test("parses YAML frontmatter properties for display", () => {
    const markdown = [
      "---",
      'status: "done"',
      "Tagged:",
      '  - "hello"',
      '  - "hi"',
      '  - "hey"',
      "---",
      "Body text.",
    ].join("\n");

    assert.deepEqual(publishedProperties(markdown), [
      { key: "status", value: "done" },
      { key: "Tagged", value: ["hello", "hi", "hey"] },
    ]);
  });

  test("omits frontmatter from descriptions", () => {
    assert.equal(
      noteDescription('---\nstatus: "done"\n---\nReal summary.'),
      "Real summary.",
    );
  });

  test("preserves supported property types", () => {
    const properties = publishedProperties(`---
title: "Roadmap"
score: 42
done: true
due: "2026-07-20"
site: "https://usemarkd.app"
tags: []
---
Body`);

    assert.deepEqual(
      properties.map(({ value }) => publishedPropertyType(value)),
      ["text", "number", "checkbox", "date", "url", "list"],
    );
    assert.equal(properties[1]?.value, 42);
    assert.equal(properties[2]?.value, true);
    assert.deepEqual(properties[5]?.value, []);
  });
});
