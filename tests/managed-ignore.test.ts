import { describe, expect, test } from "vitest";
import {
  RIFFLE_IGNORE_BLOCK,
  reconcileManagedIgnoreContent,
} from "../electron/managed-ignore";

describe("Riffle managed ignore policy", () => {
  test("appends the frozen policy while preserving user bytes", () => {
    const userContent = "# mine\r\narchive/\r\n";

    const result = reconcileManagedIgnoreContent(userContent);

    expect(result.changed).toBe(true);
    expect(result.content.startsWith(userContent)).toBe(true);
    expect(result.content.endsWith(`${RIFFLE_IGNORE_BLOCK}\n`)).toBe(true);
  });

  test("replaces one balanced block and keeps it last", () => {
    const input = [
      "before/",
      "# BEGIN RIFFLE MANAGED IGNORE",
      "old-policy/",
      "# END RIFFLE MANAGED IGNORE",
      "after/",
      "",
    ].join("\n");

    const result = reconcileManagedIgnoreContent(input);

    expect(result.content).toBe(`before/\nafter/\n${RIFFLE_IGNORE_BLOCK}\n`);
    expect(reconcileManagedIgnoreContent(result.content)).toEqual({
      changed: false,
      content: result.content,
    });
  });

  test.each([
    "# BEGIN RIFFLE MANAGED IGNORE\n",
    "# END RIFFLE MANAGED IGNORE\n",
    "# BEGIN RIFFLE MANAGED IGNORE\na\n# BEGIN RIFFLE MANAGED IGNORE\n# END RIFFLE MANAGED IGNORE\n",
  ])("rejects unbalanced or duplicate markers", (input) => {
    expect(() => reconcileManagedIgnoreContent(input)).toThrowError(
      /managed ignore markers/i,
    );
  });
});
