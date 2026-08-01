import { isMap, isScalar, isSeq, parseDocument } from "yaml";

/**
 * YAML frontmatter handling. Frontmatter stays outside the rich editor and is
 * re-attached on save. UI property edits only touch the selected flat property
 * so comments and unsupported YAML structures continue to round-trip.
 */

// Leading `---\n … \n---` block at the very start of the document.
const FRONTMATTER_RE = /^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/;

export type SplitNote = {
  /** Raw frontmatter incl. delimiters and trailing newline, or "" if none. */
  frontmatter: string;
  /** Everything after the frontmatter block. */
  body: string;
};

export function splitFrontmatter(markdown: string): SplitNote {
  const match = FRONTMATTER_RE.exec(markdown);
  if (!match) return { frontmatter: "", body: markdown };
  return {
    frontmatter: match[0],
    body: markdown.slice(match[0].length),
  };
}

/** Re-attach frontmatter to an edited body (inverse of splitFrontmatter). */
export function joinFrontmatter(frontmatter: string, body: string): string {
  return frontmatter + body;
}

export type PropertyType =
  | "text"
  | "number"
  | "checkbox"
  | "date"
  | "url"
  | "list";

export type Property = {
  key: string;
  value: string | string[] | number | boolean;
};

export function propertyType(value: Property["value"]): PropertyType {
  if (Array.isArray(value)) return "list";
  if (typeof value === "boolean") return "checkbox";
  if (typeof value === "number") return "number";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return "date";
  if (/^https?:\/\//i.test(value)) return "url";
  return "text";
}

export function parseFrontmatter(frontmatter: string): Property[] {
  const block = frontmatterBlock(frontmatter);
  if (!block) return [];

  const document = parseDocument(block.yaml);
  if (!isMap(document.contents)) return [];

  const properties: Property[] = [];
  for (const pair of document.contents.items) {
    if (!isScalar(pair.key) || typeof pair.key.value !== "string") continue;
    const key = pair.key.value;
    const value = pair.value;

    if (value == null) {
      properties.push({ key, value: "" });
      continue;
    }
    if (isScalar(value)) {
      const scalar = value.value;
      if (
        typeof scalar === "string" ||
        typeof scalar === "number" ||
        typeof scalar === "boolean"
      ) {
        properties.push({ key, value: scalar });
      }
      continue;
    }
    if (isSeq(value)) {
      const items = value.items.map((item) =>
        isScalar(item) && item.value != null ? String(item.value) : null,
      );
      if (items.every((item): item is string => item !== null)) {
        properties.push({ key, value: items });
      }
    }
  }
  return properties;
}

const PROPERTY_KEY_RE = /^[A-Za-z0-9_][\w -]*$/;

export function isValidPropertyKey(key: string): boolean {
  return PROPERTY_KEY_RE.test(key.trim());
}

function propertyLines(property: Property): string[] {
  const key = property.key.trim();
  if (Array.isArray(property.value)) {
    if (property.value.length === 0) return [`${key}: []`];
    return [
      `${key}:`,
      ...property.value.map((item) => `  - ${JSON.stringify(item)}`),
    ];
  }
  if (typeof property.value === "number" || typeof property.value === "boolean") {
    return [`${key}: ${String(property.value)}`];
  }
  return [`${key}: ${JSON.stringify(property.value)}`];
}

type FrontmatterBlock = {
  opening: string;
  yaml: string;
  beforeClosing: string;
  closing: string;
  trailing: string;
};

function frontmatterBlock(frontmatter: string): FrontmatterBlock | null {
  const match = /^(---[ \t]*\r?\n)([\s\S]*?)(\r?\n)(---[ \t]*)(\r?\n)?$/.exec(
    frontmatter,
  );
  if (!match) return null;
  return {
    opening: match[1],
    yaml: match[2],
    beforeClosing: match[3],
    closing: match[4],
    trailing: match[5] ?? "",
  };
}

function joinFrontmatterBlock(block: FrontmatterBlock, yaml: string): string {
  return `${block.opening}${yaml}${block.beforeClosing}${block.closing}${block.trailing}`;
}

function propertySourceRange(yaml: string, key: string) {
  const document = parseDocument(yaml);
  if (!isMap(document.contents)) return null;
  const pairs = document.contents.items;
  const index = pairs.findIndex(
    (pair) => isScalar(pair.key) && pair.key.value === key,
  );
  if (index < 0) return null;

  const pair = pairs[index];
  const start = pair.key?.range?.[0];
  if (start == null) return null;
  const valueEnd = pair.value?.range?.[2] ?? pair.key?.range?.[2];
  if (valueEnd == null) return null;
  return { start, end: valueEnd };
}

/** Add or replace one flat property without reserializing the full YAML block. */
export function upsertFrontmatterProperty(
  frontmatter: string,
  previousKey: string | null,
  property: Property,
): string {
  const next = { ...property, key: property.key.trim() };
  if (!isValidPropertyKey(next.key)) return frontmatter;

  if (!frontmatter) {
    return ["---", ...propertyLines(next), "---", ""].join("\n");
  }

  const block = frontmatterBlock(frontmatter);
  if (!block) return frontmatter;
  const newline = block.opening.endsWith("\r\n") ? "\r\n" : "\n";
  const replacement = propertyLines(next).join(newline);
  const range = propertySourceRange(block.yaml, previousKey ?? next.key);
  let yaml: string;
  if (range) {
    const suffix = block.yaml.slice(range.end);
    yaml = `${block.yaml.slice(0, range.start)}${replacement}${
      suffix && !suffix.startsWith("\n") && !suffix.startsWith("\r\n")
        ? newline
        : ""
    }${suffix}`;
  } else {
    yaml = `${block.yaml}${block.yaml ? newline : ""}${replacement}`;
  }
  return joinFrontmatterBlock(block, yaml);
}

/** Remove one flat property while leaving unrelated YAML untouched. */
export function removeFrontmatterProperty(
  frontmatter: string,
  key: string,
): string {
  if (!frontmatter) return "";
  const block = frontmatterBlock(frontmatter);
  if (!block) return frontmatter;
  const range = propertySourceRange(block.yaml, key);
  if (!range) return frontmatter;

  const yaml = `${block.yaml.slice(0, range.start)}${block.yaml.slice(range.end)}`
    .replace(/^\r?\n/, "")
    .replace(/\r?\n$/, "");
  return yaml.trim().length === 0 ? "" : joinFrontmatterBlock(block, yaml);
}
