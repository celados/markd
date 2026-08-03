import type { BacklinkMention } from "../src/lib/types";

const MARKDOWN_LINK = /!?\[[^\]\r\n]*\]\((?<destination><[^>\r\n]+>|[^\s)\r\n]+)(?:[ \t]+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\)/g;
const WIKI_LINK = /\[\[([^\[\]|]+)(?:\|([^\[\]]+))?\]\]/g;

type ParsedLink = {
  position: number;
  destination: string;
  wiki: boolean;
};

export function findBacklinkMentions(
  markdown: string,
  sourceRel: string,
  targetRel: string,
  noteRels: readonly string[],
): BacklinkMention[] {
  const target = normalizeDestination(targetRel);
  if (!target) return [];

  const mentions: BacklinkMention[] = [];
  let occurrence = 0;
  scanMarkdownLinks(markdown, (line, lineNumber, link) => {
    const resolved = link.wiki
      ? resolveWiki(link.destination, noteRels)
      : normalizeDestination(link.destination);
    if (resolved?.toLowerCase() !== target.toLowerCase()) return;
    mentions.push({
      sourceRel,
      context: cleanContext(line),
      line: lineNumber,
      occurrence,
    });
    occurrence += 1;
  });
  return mentions;
}

function scanMarkdownLinks(
  markdown: string,
  visit: (line: string, lineNumber: number, link: ParsedLink) => void,
): void {
  const lines = markdown.split(/\r?\n/);
  let inFrontmatter = hasFrontmatter(lines);
  let frontmatterStarted = false;
  let fence: "`" | "~" | null = null;

  for (const [index, line] of lines.entries()) {
    const trimmed = line.trimStart();
    if (inFrontmatter) {
      if (frontmatterStarted && trimmed.trimEnd() === "---") inFrontmatter = false;
      frontmatterStarted = true;
      continue;
    }
    const marker = fenceMarker(trimmed);
    if (marker) {
      fence = fence === marker ? null : fence ?? marker;
      continue;
    }
    if (fence) continue;

    const links = [...markdownLinks(line), ...wikiLinks(line)].sort(
      (left, right) => left.position - right.position,
    );
    for (const link of links) visit(line, index + 1, link);
  }
}

function markdownLinks(line: string): ParsedLink[] {
  return [...line.matchAll(MARKDOWN_LINK)].flatMap((match) => {
    if (match[0].startsWith("!")) return [];
    const destination = match.groups?.destination;
    if (!destination) return [];
    const position = match.index + match[0].indexOf(destination);
    return [{ position, destination, wiki: false }];
  });
}

function wikiLinks(line: string): ParsedLink[] {
  return [...line.matchAll(WIKI_LINK)].flatMap((match) => {
    const destination = match[1];
    if (!destination) return [];
    return [{ position: match.index + match[0].indexOf(destination), destination, wiki: true }];
  });
}

function hasFrontmatter(lines: readonly string[]): boolean {
  return lines[0]?.trim() === "---" && lines.slice(1).some((line) => line.trim() === "---");
}

function fenceMarker(line: string): "`" | "~" | null {
  if (line.startsWith("```")) return "`";
  if (line.startsWith("~~~")) return "~";
  return null;
}

function resolveWiki(raw: string, noteRels: readonly string[]): string | null {
  const clean = raw.trim().replace(/\.md$/i, "");
  if (!clean) return null;
  const full = `${clean}.md`.replaceAll("\\", "/");
  const byPath = noteRels.find((rel) => rel.toLowerCase() === full.toLowerCase());
  if (byPath) return byPath;
  const name = clean.split("/").at(-1)?.toLowerCase();
  return noteRels.find((rel) =>
    rel.split("/").at(-1)?.replace(/\.md$/i, "").toLowerCase() === name
  ) ?? full;
}

function normalizeDestination(raw: string): string | null {
  raw = raw.trim().replace(/^</, "").replace(/>$/, "");
  if (!raw || raw.startsWith("#") || raw.startsWith("//")) return null;
  const pathEnd = raw.search(/[?#]/);
  const encodedPath = pathEnd === -1 ? raw : raw.slice(0, pathEnd);
  let path: string;
  try {
    path = decodeURI(encodedPath).replaceAll("\\", "/");
  } catch {
    path = encodedPath.replaceAll("\\", "/");
  }
  if (path.split("/")[0]?.includes(":")) return null;
  while (path.startsWith("./")) path = path.slice(2);
  path = path.replace(/^\/+/, "");
  if (!path || path.split("/").includes("..")) return null;
  return /\.md$/i.test(path) ? path : `${path}.md`;
}

function cleanContext(line: string): string {
  const withoutLinks = line.replace(MARKDOWN_LINK, (match) => {
    if (match.startsWith("!")) return "";
    return match.slice(1, match.indexOf("]("));
  });
  const withoutWiki = withoutLinks.replace(
    WIKI_LINK,
    (_match, target: string, alias?: string) => alias ?? target,
  );
  const clean = withoutWiki
    .trim()
    .replace(/^#+/, "")
    .replace(/^[-*+>]+/, "")
    .trim()
    .replace(/\s+/g, " ");
  return clean.length <= 220 ? clean : `${[...clean].slice(0, 219).join("")}…`;
}
