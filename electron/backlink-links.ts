import { parser } from "@lezer/markdown";
import type { BacklinkMention } from "../src/lib/types";
import { splitFrontmatter } from "../src/lib/frontmatter";

const MARKDOWN_LINK = /!?\[[^\]\r\n]*\]\((?<destination><[^>\r\n]+>|[^\s)\r\n]+)(?:[ \t]+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\)/g;
const WIKI_LINK = /\[\[([^\[\]|]+)(?:\|([^\[\]]+))?\]\]/g;

type ParsedLink = {
  position: number;
  destination: string;
  wiki: boolean;
};

type Range = { from: number; to: number };

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
  for (const link of parseLinks(markdown)) {
    const resolved = link.wiki
      ? resolveWiki(link.destination, noteRels)
      : normalizeDestination(link.destination);
    if (resolved?.toLowerCase() !== target.toLowerCase()) continue;
    const { line, lineNumber } = sourceLineAt(markdown, link.position);
    mentions.push({
      sourceRel,
      context: cleanContext(line),
      line: lineNumber,
      occurrence,
    });
    occurrence += 1;
  }
  return mentions;
}

function parseLinks(markdown: string): ParsedLink[] {
  const { frontmatter, body } = splitFrontmatter(markdown);
  const offset = frontmatter.length;
  const tree = parser.parse(body);
  const references = new Map<string, string>();
  const excluded: Range[] = [];
  const links: ParsedLink[] = [];

  tree.iterate({
    enter(node) {
      if (node.name === "LinkReference") {
        const label = node.node.getChild("LinkLabel");
        const url = node.node.getChild("URL");
        if (label && url) {
          references.set(referenceLabel(body.slice(label.from, label.to)), body.slice(url.from, url.to));
        }
      }
    },
  });

  tree.iterate({
    enter(node) {
      if (isExcludedNode(node.name)) {
        excluded.push({ from: node.from, to: node.to });
        return false;
      }
      if (node.name !== "Link") return;
      const url = node.node.getChild("URL");
      const label = node.node.getChild("LinkLabel");
      const destination = url
        ? body.slice(url.from, url.to)
        : label
          ? references.get(referenceLabel(body.slice(label.from, label.to)))
          : undefined;
      if (destination) {
        excluded.push({ from: node.from, to: node.to });
        links.push({ position: offset + node.from, destination, wiki: false });
      }
      return false;
    },
  });

  for (const match of body.matchAll(WIKI_LINK)) {
    const destination = match[1];
    if (!destination || excluded.some((range) => overlaps(match.index, match.index + match[0].length, range))) {
      continue;
    }
    links.push({ position: offset + match.index, destination, wiki: true });
  }
  return links.sort((left, right) => left.position - right.position);
}

function isExcludedNode(name: string): boolean {
  return name === "Image" || name === "InlineCode" || name === "FencedCode" ||
    name === "CodeBlock" || name === "Comment" || name === "HTMLBlock";
}

function overlaps(from: number, to: number, range: Range): boolean {
  return from < range.to && to > range.from;
}

function referenceLabel(raw: string): string {
  return raw.slice(1, -1).trim().replace(/\s+/g, " ").toLowerCase();
}

function sourceLineAt(markdown: string, position: number): { line: string; lineNumber: number } {
  const from = markdown.lastIndexOf("\n", position - 1) + 1;
  const nextNewline = markdown.indexOf("\n", position);
  const to = nextNewline === -1 ? markdown.length : nextNewline;
  return {
    line: markdown.slice(from, to).replace(/\r$/, ""),
    lineNumber: markdown.slice(0, from).split("\n").length,
  };
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
  let path = percentDecode(encodedPath).replaceAll("\\", "/");
  if (path.split("/")[0]?.includes(":")) return null;
  while (path.startsWith("./")) path = path.slice(2);
  path = path.replace(/^\/+/, "");
  if (!path || path.split("/").includes("..")) return null;
  return /\.md$/i.test(path) ? path : `${path}.md`;
}

function percentDecode(value: string): string {
  let decoded = "";
  for (let index = 0; index < value.length;) {
    if (percentByte(value, index) === null) {
      decoded += value[index];
      index += 1;
      continue;
    }

    const runStart = index;
    const bytes: number[] = [];
    while (true) {
      const byte = percentByte(value, index);
      if (byte === null) break;
      bytes.push(byte);
      index += 3;
    }
    try {
      decoded += new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(bytes));
    } catch {
      // Invalid UTF-8 is user-authored path data. Preserve the entire encoded
      // run; partial decoding would silently change the destination identity.
      decoded += value.slice(runStart, index);
    }
  }
  return decoded;
}

function percentByte(value: string, index: number): number | null {
  if (value[index] !== "%" || index + 2 >= value.length) return null;
  const high = hex(value.charCodeAt(index + 1));
  const low = hex(value.charCodeAt(index + 2));
  return high === null || low === null ? null : (high << 4) | low;
}

function hex(code: number): number | null {
  if (code >= 0x30 && code <= 0x39) return code - 0x30;
  if (code >= 0x61 && code <= 0x66) return code - 0x61 + 10;
  if (code >= 0x41 && code <= 0x46) return code - 0x41 + 10;
  return null;
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
