import { randomUUID } from "node:crypto";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const BEGIN_MARKER = "# BEGIN RIFFLE MANAGED IGNORE";
const END_MARKER = "# END RIFFLE MANAGED IGNORE";

export const RIFFLE_IGNORED_DIRECTORIES = [
  ".git",
  ".markd",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".turbo",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "target",
] as const;

export const RIFFLE_RESERVED_ROOT_FILES = ["AGENTS.md", "CLAUDE.md"] as const;

export const RIFFLE_IGNORE_BLOCK = [
  BEGIN_MARKER,
  ".*",
  ...RIFFLE_IGNORED_DIRECTORIES.map((directory) => `${directory}/`),
  ...RIFFLE_RESERVED_ROOT_FILES.map((file) => `/${file}`),
  END_MARKER,
].join("\n");

type ReconciledIgnore = {
  changed: boolean;
  content: string;
};

export function reconcileManagedIgnoreContent(input: string): ReconciledIgnore {
  const begins = markerRanges(input, BEGIN_MARKER);
  const ends = markerRanges(input, END_MARKER);
  if (begins.length !== ends.length || begins.length > 1) {
    throw new Error("Invalid Riffle managed ignore markers.");
  }

  let userContent = input;
  if (begins.length === 1) {
    const begin = begins[0]!;
    const end = ends[0]!;
    if (end.start < begin.end) {
      throw new Error("Invalid Riffle managed ignore markers.");
    }
    userContent = input.slice(0, begin.start) + input.slice(end.end);
  }

  const separator = userContent.length > 0 && !userContent.endsWith("\n") ? "\n" : "";
  const content = `${userContent}${separator}${RIFFLE_IGNORE_BLOCK}\n`;
  return { changed: content !== input, content };
}

export async function reconcileManagedIgnore(root: string): Promise<boolean> {
  const path = join(root, ".ignore");
  let current = "";
  try {
    current = await readFile(path, "utf8");
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
  const reconciled = reconcileManagedIgnoreContent(current);
  if (!reconciled.changed) return false;

  const temporary = join(root, `.riffle-ignore-${process.pid}-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, reconciled.content, { flag: "wx" });
    await rename(temporary, path);
  } catch (error) {
    // The original atomic-write failure is the actionable error; cleanup is
    // best-effort and must not replace it with a secondary unlink failure.
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
  return true;
}

function markerRanges(input: string, marker: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  let offset = 0;
  for (const line of input.match(/.*(?:\n|$)/g) ?? []) {
    const content = line.endsWith("\n") ? line.slice(0, -1) : line;
    const normalized = content.endsWith("\r") ? content.slice(0, -1) : content;
    if (normalized === marker) ranges.push({ start: offset, end: offset + line.length });
    offset += line.length;
  }
  return ranges;
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
