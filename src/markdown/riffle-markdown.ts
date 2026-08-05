import { parseMarkdown, type Node } from "comark";
import { wikiToMarkdown } from "@/lib/noteLinks";

type ProjectedAttributes = Record<
  string,
  string | number | boolean | { textAlign: "left" | "center" | "right" }
>;

export type ProjectedNode =
  | string
  | { kind: "fragment"; children: ProjectedNode[] }
  | {
      kind: "element";
      tag: string;
      attributes: ProjectedAttributes;
      children: ProjectedNode[];
    }
  | {
      kind: "note-link";
      rel: string;
      exists: boolean;
      title?: string;
      children: ProjectedNode[];
    }
  | {
      kind: "external-link";
      href: string;
      title?: string;
      children: ProjectedNode[];
    }
  | {
      kind: "fragment-link";
      href: string;
      title?: string;
      children: ProjectedNode[];
    }
  | {
      kind: "rejected-link";
      children: ProjectedNode[];
    }
  | {
      kind: "asset";
      source: string;
      rel: string | null;
      alt?: string;
      title?: string;
    }
  | { kind: "task"; checked: boolean }
  | { kind: "code-block"; code: string; language?: string };

export type ProjectedDocument = { nodes: ProjectedNode[] };

type NavigationTarget =
  | { kind: "note"; rel: string; exists: boolean }
  | { kind: "external"; href: string }
  | { kind: "fragment"; href: string }
  | { kind: "rejected" };

const markdownTags = new Set([
  "a",
  "blockquote",
  "br",
  "code",
  "del",
  "em",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "img",
  "li",
  "ol",
  "p",
  "pre",
  "s",
  "strong",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "ul",
]);

const embeddedMarkupTags = new Set([
  "abbr",
  "article",
  "aside",
  "details",
  "div",
  "dl",
  "dd",
  "dt",
  "figcaption",
  "figure",
  "kbd",
  "mark",
  "section",
  "span",
  "sub",
  "summary",
  "sup",
  "time",
]);

const emptyAttributes = new Set<string>();
const markdownAttributes: Record<string, ReadonlySet<string>> = {
  a: new Set(["href", "title"]),
  code: new Set(["class"]),
  h1: new Set(["id"]),
  h2: new Set(["id"]),
  h3: new Set(["id"]),
  h4: new Set(["id"]),
  h5: new Set(["id"]),
  h6: new Set(["id"]),
  img: new Set(["src", "alt", "title"]),
  li: new Set(["class"]),
  ol: new Set(["start"]),
  pre: new Set(["language", "filename", "highlights", "meta"]),
  td: new Set(["style"]),
  th: new Set(["style"]),
  ul: new Set(["class"]),
};

const embeddedAttributes: Record<string, ReadonlySet<string>> = {
  abbr: new Set(["title", "aria-label"]),
  article: new Set(["title", "aria-label"]),
  aside: new Set(["title", "aria-label"]),
  details: new Set(["title", "aria-label", ":open"]),
  div: new Set(["title", "aria-label"]),
  dl: new Set(["title", "aria-label"]),
  dd: new Set(["title", "aria-label"]),
  dt: new Set(["title", "aria-label"]),
  figcaption: new Set(["title", "aria-label"]),
  figure: new Set(["title", "aria-label"]),
  kbd: new Set(["title", "aria-label"]),
  mark: new Set(["title", "aria-label"]),
  section: new Set(["title", "aria-label"]),
  span: new Set(["title", "aria-label"]),
  sub: new Set(["title", "aria-label"]),
  summary: new Set(["title", "aria-label"]),
  sup: new Set(["title", "aria-label"]),
  time: new Set(["title", "aria-label", "datetime"]),
};

export async function projectRiffleMarkdown(
  markdown: string,
  sourceRel: string,
  noteRels: readonly string[],
): Promise<ProjectedDocument> {
  assertNoComarkComponents(markdown);
  const notes = noteRels.map((rel) => ({ rel }));
  const projectedInput = wikiToMarkdown(markdown, notes, sourceRel);
  // Static Notes intentionally use a history-free parse. Incremental parser
  // state belongs to a future Markdown Stream contract, not persisted Notes.
  const document = await parseMarkdown(projectedInput, {
    autoClose: false,
    html: true,
  });
  return {
    nodes: document.nodes.map((node) =>
      projectNode(node, { sourceRel, noteRels }, false),
    ),
  };
}

function projectNode(
  node: Node,
  context: { sourceRel: string; noteRels: readonly string[] },
  insideCode: boolean,
): ProjectedNode {
  if (typeof node === "string") {
    return insideCode ? node : projectSoftBreaks(node);
  }
  if (node[0] === null) return "";

  const [tag, attributes, ...children] = node;
  const embedded = isEmbeddedMarkup(attributes);
  assertAllowedTag(tag, embedded);

  if (tag === "input") {
    if (embedded) throw new Error("Unsupported Embedded Markup: input");
    return projectTaskInput(attributes);
  }
  if (tag === "a") {
    const projected = children.map((child) => projectNode(child, context, false));
    const title = optionalString(attributes.title);
    assertAttributes(tag, attributes, markdownAttributes.a);
    const target = classifyNavigation(
      optionalString(attributes.href),
      context.sourceRel,
      context.noteRels,
    );
    if (target.kind === "note") {
      return {
        kind: "note-link",
        title,
        children: projected,
        rel: target.rel,
        exists: target.exists,
      };
    }
    if (target.kind === "external") {
      return {
        kind: "external-link",
        title,
        children: projected,
        href: target.href,
      };
    }
    if (target.kind === "fragment") {
      return {
        kind: "fragment-link",
        title,
        children: projected,
        href: target.href,
      };
    }
    return { kind: "rejected-link", children: projected };
  }
  if (tag === "img") {
    assertAttributes(tag, attributes, markdownAttributes.img);
    const source = optionalString(attributes.src) ?? "";
    return {
      kind: "asset",
      source,
      rel: classifyAsset(source),
      alt: optionalString(attributes.alt),
      title: optionalString(attributes.title),
    };
  }
  if (tag === "pre") {
    assertAttributes(tag, attributes, markdownAttributes.pre);
    return {
      kind: "code-block",
      code: textContent(children),
      language: safeLanguage(optionalString(attributes.language)),
    };
  }

  const projected = children.map((child) => projectNode(child, context, tag === "code"));
  return {
    kind: "element",
    tag,
    attributes: projectAttributes(tag, attributes, embedded),
    children: projected,
  };
}

function projectSoftBreaks(text: string): ProjectedNode {
  const lines = text.split("\n");
  if (lines.length === 1) return text;
  const children: ProjectedNode[] = [];
  for (const [index, line] of lines.entries()) {
    if (index > 0) {
      children.push({ kind: "element", tag: "br", attributes: {}, children: [] });
    }
    children.push(line);
  }
  return { kind: "fragment", children };
}

function projectTaskInput(attributes: Record<string, unknown>): ProjectedNode {
  const className = optionalString(attributes.class);
  const keys = Object.keys(attributes).filter((key) => key !== "$");
  if (
    className !== "task-list-item-checkbox" ||
    attributes.type !== "checkbox" ||
    attributes[":disabled"] !== "true" ||
    keys.some(
      (key) => !["class", "type", ":disabled", ":checked"].includes(key),
    )
  ) {
    throw new Error("Unsupported Markdown task input");
  }
  return { kind: "task", checked: attributes[":checked"] === "true" };
}

function projectAttributes(
  tag: string,
  attributes: Record<string, unknown>,
  embedded: boolean,
): ProjectedAttributes {
  const allowed = embedded
    ? embeddedAttributes[tag] ?? markdownAttributes[tag] ?? emptyAttributes
    : markdownAttributes[tag] ?? emptyAttributes;
  assertAttributes(tag, attributes, allowed);
  const projected: ProjectedAttributes = {};

  const title = optionalString(attributes.title);
  const ariaLabel = optionalString(attributes["aria-label"]);
  if (title) projected.title = title;
  if (ariaLabel) projected["aria-label"] = ariaLabel;

  if (/^h[1-6]$/.test(tag)) {
    const id = safeId(optionalString(attributes.id));
    if (id) projected.id = id;
  } else if (tag === "ol") {
    const start = positiveInteger(attributes.start);
    if (start !== undefined) projected.start = start;
  } else if (tag === "th" || tag === "td") {
    const alignment = tableAlignment(optionalString(attributes.style));
    if (alignment) projected.style = { textAlign: alignment };
  } else if (tag === "ul" || tag === "li" || tag === "code") {
    const className = safeGeneratedClass(tag, optionalString(attributes.class));
    if (className) projected.className = className;
  } else if (tag === "details" && attributes[":open"] === "true") {
    projected.open = true;
  } else if (tag === "time") {
    const dateTime = optionalString(attributes.datetime);
    if (dateTime) projected.dateTime = dateTime;
  }
  return projected;
}

function assertAllowedTag(tag: string, embedded: boolean): void {
  if (tag === "input" || markdownTags.has(tag)) return;
  if (!embedded) throw new Error(`Unsupported Comark component: ${tag}`);
  if (!embeddedMarkupTags.has(tag)) {
    throw new Error(`Unsupported Embedded Markup: ${tag}`);
  }
}

function assertAttributes(
  tag: string,
  attributes: Record<string, unknown>,
  allowed: ReadonlySet<string>,
): void {
  const unsupported = Object.keys(attributes).find(
    (attribute) => attribute !== "$" && !allowed.has(attribute),
  );
  if (unsupported) {
    throw new Error(`Unsupported Markdown attribute: ${tag}.${unsupported}`);
  }
}

function isEmbeddedMarkup(attributes: Record<string, unknown>): boolean {
  const metadata = attributes.$;
  return (
    typeof metadata === "object" &&
    metadata !== null &&
    "html" in metadata &&
    (metadata as { html?: unknown }).html === 1
  );
}

function classifyNavigation(
  rawHref: string | undefined,
  sourceRel: string,
  noteRels: readonly string[],
): NavigationTarget {
  const href = canonicalDecode(rawHref);
  if (!href) return { kind: "rejected" };
  if (href.startsWith("#")) {
    return /^[#][^\u0000-\u001f\u007f]*$/.test(href)
      ? { kind: "fragment", href }
      : { kind: "rejected" };
  }
  if (href.startsWith("//")) return { kind: "rejected" };

  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(href)?.[1]?.toLowerCase();
  if (scheme) {
    if (scheme !== "http" && scheme !== "https") return { kind: "rejected" };
    try {
      const url = new URL(href);
      if (url.username || url.password) return { kind: "rejected" };
      return { kind: "external", href: url.href };
    } catch {
      return { kind: "rejected" };
    }
  }

  const path = href.split(/[?#]/, 1)[0];
  if (!path || path.includes("\\")) return { kind: "rejected" };
  const explicitRelative = path.startsWith("./") || path.startsWith("../");
  const rooted = path.startsWith("/");
  const direct = normalizeVaultPath([], path.replace(/^\/+/, ""));
  const sourceDir = sourceRel.split("/").slice(0, -1);
  const relative = normalizeVaultPath(sourceDir, path);
  const candidates = rooted
    ? [direct]
    : explicitRelative
      ? [relative]
      : [direct, relative];
  const noteLookup = new Map(noteRels.map((rel) => [rel.toLowerCase(), rel]));
  const normalizedCandidates = candidates
    .filter((candidate): candidate is string => Boolean(candidate))
    .map(withMarkdownExtension)
    .filter((candidate) => !candidate.startsWith(".markd/"));
  if (normalizedCandidates.length === 0) return { kind: "rejected" };
  const existing = normalizedCandidates
    .map((candidate) => noteLookup.get(candidate.toLowerCase()))
    .find((candidate): candidate is string => Boolean(candidate));
  const rel = existing ?? normalizedCandidates[0]!;
  return {
    kind: "note",
    rel,
    exists: Boolean(existing),
  };
}

function classifyAsset(rawSource: string): string | null {
  const source = canonicalDecode(rawSource);
  if (!source || source.includes("?") || source.includes("#")) return null;
  if (/^[a-z][a-z0-9+.-]*:|^\/\//i.test(source)) return null;
  const normalized = normalizeVaultPath([], source);
  if (!normalized?.startsWith(".markd/assets/")) return null;
  if (!/\.(?:gif|jpe?g|png|webp)$/i.test(normalized)) return null;
  return normalized;
}

function canonicalDecode(raw: string | undefined): string | null {
  if (!raw) return null;
  let value = raw.trim();
  if (!value || /[\u0000-\u001f\u007f\\]/.test(value)) return null;
  value = value.replace(/&#(?:x([0-9a-f]+)|([0-9]+));?/gi, (_, hex, decimal) => {
    const codePoint = Number.parseInt(hex ?? decimal, hex ? 16 : 10);
    return Number.isSafeInteger(codePoint) && codePoint <= 0x10ffff
      ? String.fromCodePoint(codePoint)
      : "\u0000";
  });
  if (/&[a-z][a-z0-9]+;/i.test(value)) return null;
  for (let depth = 0; depth < 4; depth += 1) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(value);
    } catch {
      return null;
    }
    if (decoded === value) break;
    value = decoded;
  }
  if (/%[0-9a-f]{2}/i.test(value)) return null;
  if (/[\u0000-\u001f\u007f\\]/.test(value)) return null;
  return value.trim();
}

function normalizeVaultPath(base: readonly string[], path: string): string | null {
  const segments = [...base];
  for (const segment of path.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (segments.length === 0) return null;
      segments.pop();
      continue;
    }
    if (segment.includes("\u0000")) return null;
    segments.push(segment);
  }
  return segments.length > 0 ? segments.join("/") : null;
}

function withMarkdownExtension(path: string): string {
  return /\.md$/i.test(path) ? path : `${path}.md`;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function positiveInteger(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  if (typeof value !== "string" || !/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return parsed > 0 ? parsed : undefined;
}

function tableAlignment(
  style: string | undefined,
): "left" | "center" | "right" | undefined {
  const match = /^text-align:(left|center|right)$/.exec(style ?? "");
  return match?.[1] as "left" | "center" | "right" | undefined;
}

function safeGeneratedClass(tag: string, className: string | undefined) {
  if (!className) return undefined;
  if (tag === "ul" && className === "contains-task-list") return className;
  if (tag === "li" && className === "task-list-item") return className;
  if (tag === "code" && /^language-[a-z0-9_-]+$/i.test(className)) return className;
  throw new Error(`Unsupported Markdown attribute: ${tag}.class`);
}

function safeId(id: string | undefined): string | undefined {
  if (!id || /[\u0000-\u001f\u007f\s"'<>]/.test(id)) return undefined;
  return id;
}

function safeLanguage(language: string | undefined): string | undefined {
  return language && /^[a-z0-9_-]+$/i.test(language) ? language : undefined;
}

function textContent(nodes: readonly Node[]): string {
  let text = "";
  for (const node of nodes) {
    if (typeof node === "string") text += node;
    else if (node[0] !== null) text += textContent(node.slice(2) as Node[]);
  }
  return text;
}

function assertNoComarkComponents(markdown: string): void {
  let fence: { marker: "`" | "~"; length: number } | null = null;
  for (const line of markdown.split("\n")) {
    const fenceMatch = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1]![0] as "`" | "~";
      const length = fenceMatch[1]!.length;
      if (!fence) fence = { marker, length };
      else if (fence.marker === marker && length >= fence.length) fence = null;
      continue;
    }
    if (fence) continue;
    const prose = maskInlineCode(line);
    if (/^\s*:{2,}[a-z][a-z0-9-]*(?:\s|\{|$)/i.test(prose)) {
      throw new Error("Comark components are not Riffle Markdown");
    }
    if (/(^|[^a-z0-9]):[a-z][a-z0-9-]*(?=\[|\{|\s|[.,!?;:]|$)/i.test(prose)) {
      throw new Error("Comark components are not Riffle Markdown");
    }
  }
}

function maskInlineCode(line: string): string {
  const characters = [...line];
  let index = 0;
  while (index < characters.length) {
    if (characters[index] !== "`") {
      index += 1;
      continue;
    }
    let openerEnd = index;
    while (characters[openerEnd] === "`") openerEnd += 1;
    const length = openerEnd - index;
    let closer = openerEnd;
    while (closer < characters.length) {
      if (characters[closer] !== "`") {
        closer += 1;
        continue;
      }
      let closerEnd = closer;
      while (characters[closerEnd] === "`") closerEnd += 1;
      if (closerEnd - closer === length) {
        characters.fill(" ", index, closerEnd);
        index = closerEnd;
        break;
      }
      closer = closerEnd;
    }
    if (closer >= characters.length) index = openerEnd;
  }
  return characters.join("");
}
