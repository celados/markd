/**
 * Internal Markdown links use a vault-relative Note path, for example
 * `[Roadmap](projects/roadmap.md)`. Riffle also projects wiki-link syntax to
 * this navigation shape for rendering without mutating the source file.
 */

/** True if `href` points outside the vault (has a scheme) or is an anchor. */
function isExternal(href: string) {
  return /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("#");
}

/**
 * Resolve a link href to a vault note rel, or null if it isn't an internal
 * note link. Accepts `projects/app.md`, `./app.md`, `/app.md`, `app` (no ext).
 */
export function hrefToRel(href: string | null | undefined): string | null {
  if (!href) return null;
  const trimmed = href.trim();
  if (!trimmed || isExternal(trimmed)) return null;
  let rel = decodeURI(trimmed).split(/[?#]/)[0].replace(/^\.?\//, "");
  if (!rel) return null;
  if (!/\.md$/i.test(rel)) rel += ".md";
  return rel;
}

/** Vault rel → link href (path segments percent-encoded so spaces stay valid). */
export function relToHref(rel: string): string {
  return rel.split("/").map(encodeURIComponent).join("/");
}

/** Vault rel → visible label, relative when it sits below the current note. */
export function relToLabel(rel: string, fromRel?: string): string {
  const label = rel.replace(/\.md$/i, "");
  const fromDir = fromRel?.split("/").slice(0, -1).join("/");
  if (fromDir && label.startsWith(`${fromDir}/`)) {
    return label.slice(fromDir.length + 1);
  }
  return label;
}

/**
 * Resolve a `[[wiki]]` target to a note. Matches by full rel first, then by
 * bare filename anywhere in the vault (wiki-style); falls back to a
 * root-level path if nothing matches, so the link still points somewhere sane.
 */
export function resolveWiki(
  target: string,
  notes: { rel: string }[],
  fromRel?: string,
): { rel: string; title: string } {
  const clean = target.trim().replace(/\.md$/i, "");
  const lower = clean.toLowerCase();
  const byRel = notes.find(
    (n) => n.rel.replace(/\.md$/i, "").toLowerCase() === lower,
  );
  const byName = byRel
    ? undefined
    : notes.find(
        (n) =>
          (n.rel.split("/").pop() ?? "").replace(/\.md$/i, "").toLowerCase() ===
          lower,
      );
  const rel = (byRel ?? byName)?.rel ?? `${clean}.md`;
  const title = relToLabel(rel, fromRel);
  return { rel, title };
}

/**
 * Project `[[target]]` / `[[target|alias]]` syntax into standard Markdown links
 * for rendering. The returned string is view input, never a source mutation.
 */
export function wikiToMarkdown(
  markdown: string,
  notes: { rel: string }[],
  fromRel?: string,
): string {
  const withWikiLinks = markdown.replace(
    /\[\[([^[\]|]+)(?:\|([^[\]]+))?\]\]/g,
    (_, target: string, alias?: string) => {
      const { rel, title } = resolveWiki(target, notes, fromRel);
      const text = (alias ?? title).trim();
      return `[${text}](${relToHref(rel)})`;
    },
  );

  return expandDefaultLinkLabels(withWikiLinks, notes, fromRel);
}

/** Expand basename-only labels for existing links to nested notes. */
export function expandDefaultLinkLabels(
  markdown: string,
  notes: { rel: string }[],
  fromRel?: string,
): string {
  const noteRels = new Map(
    notes.map((note) => [note.rel.toLowerCase(), note.rel]),
  );

  return markdown.replace(
    /(?<!!)\[([^\]]+)\]\(([^)\s]+)(?:\s+("[^"]*"|'[^']*'))?\)/g,
    (match, label: string, href: string, title?: string) => {
      let candidate: string | null;
      try {
        candidate = hrefToRel(href);
      } catch {
        return match;
      }
      if (!candidate) return match;

      const rel = noteRels.get(candidate.toLowerCase());
      if (!rel || !rel.includes("/")) return match;

      const filename = rel.split("/").pop()?.replace(/\.md$/i, "") ?? "";
      const fullLabel = relToLabel(rel);
      const currentLabel = label.trim().toLowerCase();
      if (
        currentLabel !== filename.toLowerCase() &&
        currentLabel !== fullLabel.toLowerCase()
      ) {
        return match;
      }

      const suffix = title ? ` ${title}` : "";
      return `[${relToLabel(rel, fromRel)}](${href}${suffix})`;
    },
  );
}
