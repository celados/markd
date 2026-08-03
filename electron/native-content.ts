import { constants } from "node:fs";
import { open, realpath, stat } from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  normalize,
  relative,
  resolve,
  sep,
} from "node:path";
import { assetContentType, safeAssetSegments } from "./asset-url";

export class NativeContentError extends Error {
  readonly kind: "INVALID_PATH" | "NOT_FOUND" | "IO_ERROR";

  constructor(kind: "INVALID_PATH" | "NOT_FOUND" | "IO_ERROR", message: string) {
    super(message);
    this.name = "NativeContentError";
    this.kind = kind;
  }
}

export async function loadAssetResponse(
  assetRoot: string,
  requestUrl: string,
): Promise<Response> {
  const url = new URL(requestUrl);
  if (url.protocol !== "markd-asset:" || url.hostname !== "vault") {
    throw invalidPath("Asset URL is outside the active Vault.");
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
  } catch {
    throw invalidPath("Asset URL is invalid.");
  }
  const parts = safeAssetSegments(decoded);
  const contentType = parts ? assetContentType(parts.at(-1)!) : null;
  if (!parts || !contentType) throw invalidPath("Asset URL is invalid.");

  const canonicalRoot = await realpath(assetRoot).catch(() => {
    throw new NativeContentError("NOT_FOUND", "The active Vault asset folder is unavailable.");
  });
  if (normalize(canonicalRoot) !== normalize(assetRoot)) {
    throw invalidPath("The active Vault asset folder is not canonical.");
  }
  const candidate = resolve(canonicalRoot, ...parts);
  assertContained(canonicalRoot, candidate);
  const canonical = await realpath(candidate).catch(() => {
    throw new NativeContentError("NOT_FOUND", "Asset does not exist.");
  });
  if (normalize(candidate) !== normalize(canonical)) {
    throw invalidPath("Asset path contains a symbolic link.");
  }
  assertContained(canonicalRoot, canonical);

  const handle = await open(canonical, constants.O_RDONLY | constants.O_NOFOLLOW).catch((error) => {
    throw new NativeContentError(
      "IO_ERROR",
      error instanceof Error ? error.message : "Asset could not be opened.",
    );
  });
  try {
    if (!(await handle.stat()).isFile()) throw invalidPath("Asset is not a file.");
    const bytes = await handle.readFile();
    return new Response(new Uint8Array(bytes), {
      headers: {
        "content-type": contentType,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        "access-control-allow-origin": "*",
      },
    });
  } finally {
    await handle.close();
  }
}

export async function writeExportFile(path: string, content: string): Promise<string> {
  if (!isAbsolute(path) || basename(path) === "" || basename(path) === ".") {
    throw invalidPath("Export destination is invalid.");
  }
  const canonicalParent = await realpath(dirname(path)).catch(() => {
    throw new NativeContentError("NOT_FOUND", "Export destination folder does not exist.");
  });
  if (!(await stat(canonicalParent)).isDirectory()) {
    throw invalidPath("Export destination folder is invalid.");
  }
  const target = join(canonicalParent, basename(path));
  assertContained(canonicalParent, target);
  try {
    const existing = await realpath(target);
    if (normalize(existing) !== normalize(target)) {
      throw invalidPath("Export destination contains a symbolic link.");
    }
  } catch (error) {
    if (error instanceof NativeContentError) throw error;
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new NativeContentError("IO_ERROR", "Export destination could not be validated.");
    }
  }

  const handle = await open(
    target,
    // The realpath check rejects an existing link; O_NOFOLLOW also closes the
    // leaf-swap race between that check and opening the destination.
    constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW,
    0o666,
  ).catch((error) => {
    throw new NativeContentError(
      "IO_ERROR",
      error instanceof Error ? error.message : "Export could not be written.",
    );
  });
  try {
    await handle.writeFile(content, "utf8");
  } finally {
    await handle.close();
  }
  return target;
}

function assertContained(root: string, candidate: string): void {
  const offset = relative(root, candidate);
  if (offset && offset !== ".." && !offset.startsWith(`..${sep}`) && !isAbsolute(offset)) return;
  throw invalidPath("Path leaves its approved root.");
}

function invalidPath(message: string): NativeContentError {
  return new NativeContentError("INVALID_PATH", message);
}
