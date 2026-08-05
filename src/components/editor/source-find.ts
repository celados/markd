export type FindMatch = { from: number; to: number };

export function findPlainTextMatches(
  text: string,
  query: string,
): FindMatch[] {
  const needle = query.toLocaleLowerCase();
  if (!needle) return [];

  const matches: FindMatch[] = [];
  const haystack = text.toLocaleLowerCase();
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    matches.push({ from: index, to: index + query.length });
    index = haystack.indexOf(needle, index + needle.length);
  }
  return matches;
}

export function replaceTextRange(
  text: string,
  match: FindMatch,
  replacement: string,
) {
  return `${text.slice(0, match.from)}${replacement}${text.slice(match.to)}`;
}

export function replaceMatches(
  text: string,
  matches: FindMatch[],
  replacement: string,
) {
  return [...matches]
    .sort((a, b) => b.from - a.from)
    .reduce(
      (nextText, match) => replaceTextRange(nextText, match, replacement),
      text,
    );
}

export function wrapIndex(index: number, length: number) {
  if (length === 0) return 0;
  return ((index % length) + length) % length;
}
