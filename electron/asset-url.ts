const assetPrefix = ".markd/assets/";

export const assetTypes = {
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
} as const;

export function assetUrl(rel: string): string | null {
  if (!rel.startsWith(assetPrefix)) return null;
  const parts = safeAssetSegments(rel.slice(assetPrefix.length));
  if (!parts || !assetContentType(parts.at(-1)!)) return null;
  return `riffle-asset://vault/${parts.map(encodeURIComponent).join("/")}`;
}

export function safeAssetSegments(path: string): string[] | null {
  if (!path || path.includes("\\") || path.includes("\0")) return null;
  const parts = path.split("/");
  return parts.some((part) => !part || part === "." || part === "..") ? null : parts;
}

export function assetContentType(path: string): string | null {
  const dot = path.lastIndexOf(".");
  const extension = (dot < 0 ? "" : path.slice(dot).toLowerCase()) as keyof typeof assetTypes;
  return assetTypes[extension] ?? null;
}
