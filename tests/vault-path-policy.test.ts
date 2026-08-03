import { describe, expect, test } from "vitest";
import { isAcceptedVaultRel } from "../electron/vault-path-policy";

describe("Vault accepted-path hard policy", () => {
  test.each([
    ".markd/todos.json",
    "notes/.private.md",
    "notes/.hidden/Visible.md",
    "packages/node_modules/readme.md",
    "apps/.next/page.md",
    "rust/target/readme.md",
    "dist/output.md",
    "AGENTS.md",
    "CLAUDE.md",
  ])("rejects %s even if an ignore rule re-includes it", (rel) => {
    expect(isAcceptedVaultRel(rel)).toBe(false);
  });

  test.each([
    "Note.md",
    "notes/Visible.md",
    "building/Plan.md",
    "nested/AGENTS.md",
  ])("accepts ordinary Vault paths such as %s", (rel) => {
    expect(isAcceptedVaultRel(rel)).toBe(true);
  });
});
