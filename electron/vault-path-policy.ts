import {
  RIFFLE_IGNORED_DIRECTORIES,
  RIFFLE_RESERVED_ROOT_FILES,
} from "./managed-ignore";

const ignoredDirectories = new Set<string>(RIFFLE_IGNORED_DIRECTORIES);
const reservedRootFiles = new Set<string>(RIFFLE_RESERVED_ROOT_FILES);

export function isAcceptedVaultRel(rel: string): boolean {
  if (rel === "") return true;
  const parts = rel.split(/[\\/]/);
  if (
    parts.some(
      (part) =>
        part.length === 0 ||
        part === "." ||
        part === ".." ||
        part.startsWith(".") ||
        ignoredDirectories.has(part),
    )
  ) {
    return false;
  }
  return !reservedRootFiles.has(parts[0]!);
}
