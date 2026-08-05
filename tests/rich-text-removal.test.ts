import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const root = fileURLToPath(new URL("..", import.meta.url));
const activeRoots = ["src", "electron", "site", "services"];
const ignoredDirectoryNames = new Set([
  ".git",
  ".next",
  "dist",
  "node_modules",
  "release",
]);
const activeExtensions = new Set([
  ".css",
  ".js",
  ".json",
  ".mjs",
  ".ts",
  ".tsx",
  ".tsrx",
]);
const removedRuntimePattern =
  /@octanejs\/tiptap|@tiptap\/|\bprosemirror(?:-|\/)|\bProseMirror\b/iu;
const removedRuntimeMatchesPattern =
  /@octanejs\/tiptap|@tiptap\/|\bprosemirror(?:-|\/)|\bProseMirror\b/giu;
const removedSourceFiles = [
  "src/components/editor/CodeBlock.tsx",
  "src/components/editor/NoteLinkPicker.tsrx",
  "src/components/editor/SelectionMenu.tsrx",
  "src/components/editor/SlashMenu.tsrx",
  "src/components/editor/extensions.ts",
  "src/components/editor/insertImage.ts",
  "src/components/editor/noteFind.ts",
  "src/components/editor/textColors.ts",
  "src/components/editor/useNoteFindReplace.ts",
  "src/components/editor/wikiLink.ts",
  "src/lib/markdownPaste.ts",
];

function collectActiveFiles(path: string): string[] {
  const absolute = join(root, path);
  if (!existsSync(absolute)) return [];
  if (!statSync(absolute).isDirectory()) return [absolute];

  return readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const child = join(path, entry.name);
    if (entry.isDirectory()) {
      return ignoredDirectoryNames.has(entry.name) ? [] : collectActiveFiles(child);
    }
    return activeExtensions.has(extname(entry.name)) ? [join(root, child)] : [];
  });
}

function runtimeReferences(path: string) {
  const source = readFileSync(path, "utf8");
  return [...source.matchAll(removedRuntimeMatchesPattern)].map((match) => ({
    file: relative(root, path),
    match: match[0],
  }));
}

describe("removed rich-text runtime gate", () => {
  test("keeps Tiptap and ProseMirror out of dependencies and the lockfile", () => {
    const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    const packageSections = [
      packageJson.dependencies,
      packageJson.devDependencies,
      packageJson.optionalDependencies,
      packageJson.overrides,
    ];
    const packageNames = packageSections.flatMap((section) =>
      Object.keys(section ?? {}),
    );

    expect(packageNames.filter((name) => removedRuntimePattern.test(name))).toEqual(
      [],
    );
    expect(readFileSync(join(root, "pnpm-lock.yaml"), "utf8")).not.toMatch(
      removedRuntimePattern,
    );
  });

  test("keeps removed packages and ProseMirror runtime paths out of active code", () => {
    const files = [
      ...activeRoots.flatMap(collectActiveFiles),
      ...[
        "electron-builder.yml",
        "package.json",
        "pnpm-workspace.yaml",
        "tsconfig.json",
        "vite.config.ts",
      ].map((path) => join(root, path)),
    ];

    expect(files.flatMap(runtimeReferences)).toEqual([]);
  });

  test("does not restore abandoned editor modules", () => {
    expect(removedSourceFiles.filter((path) => existsSync(join(root, path)))).toEqual(
      [],
    );
  });

  test("retains the Readonly View parser and Source Editor dependencies", () => {
    const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    expect(packageJson.dependencies.comark).toBeTypeOf("string");
    expect(packageJson.dependencies["@codemirror/view"]).toBeTypeOf("string");
    expect(packageJson.dependencies["@codemirror/lang-markdown"]).toBeTypeOf(
      "string",
    );
  });
});
