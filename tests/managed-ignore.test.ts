import { describe, expect, test } from "vitest";
import {
  MARKD_IGNORE_BLOCK,
  reconcileManagedIgnoreContent,
} from "../electron/managed-ignore";

describe("Markd managed ignore policy", () => {
  test("appends the frozen policy while preserving user bytes", () => {
    const userContent = "# mine\r\narchive/\r\n";

    const result = reconcileManagedIgnoreContent(userContent);

    expect(result.changed).toBe(true);
    expect(result.content.startsWith(userContent)).toBe(true);
    expect(result.content.endsWith(`${MARKD_IGNORE_BLOCK}\n`)).toBe(true);
  });

  test("replaces one balanced block and keeps it last", () => {
    const input = [
      "before/",
      "# BEGIN MARKD MANAGED IGNORE",
      "old-policy/",
      "# END MARKD MANAGED IGNORE",
      "after/",
      "",
    ].join("\n");

    const result = reconcileManagedIgnoreContent(input);

    expect(result.content).toBe(`before/\nafter/\n${MARKD_IGNORE_BLOCK}\n`);
    expect(reconcileManagedIgnoreContent(result.content)).toEqual({
      changed: false,
      content: result.content,
    });
  });

  test.each([
    "# BEGIN MARKD MANAGED IGNORE\n",
    "# END MARKD MANAGED IGNORE\n",
    "# BEGIN MARKD MANAGED IGNORE\na\n# BEGIN MARKD MANAGED IGNORE\n# END MARKD MANAGED IGNORE\n",
  ])("rejects unbalanced or duplicate markers", (input) => {
    expect(() => reconcileManagedIgnoreContent(input)).toThrowError(
      /managed ignore markers/i,
    );
  });
});
