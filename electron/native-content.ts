import { constants } from "node:fs";
import { randomUUID } from "node:crypto";
import { open, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
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
import { fileTypeFromBuffer } from "file-type";

const supportedAssetTypes = {
  gif: "image/gif",
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
} as const;

export type SupportedAssetExtension = keyof typeof supportedAssetTypes;

export type ValidatedAsset = {
  bytes: Buffer;
  extension: SupportedAssetExtension;
  contentType: (typeof supportedAssetTypes)[SupportedAssetExtension];
};

export class NativeContentError extends Error {
  readonly kind: "INVALID_INPUT" | "INVALID_PATH" | "NOT_FOUND" | "IO_ERROR";

  constructor(
    kind: "INVALID_INPUT" | "INVALID_PATH" | "NOT_FOUND" | "IO_ERROR",
    message: string,
  ) {
    super(message);
    this.name = "NativeContentError";
    this.kind = kind;
  }
}

export async function validateAssetContent(
  input: string,
  extension: string,
): Promise<ValidatedAsset> {
  const requestedExtension = normalizeAssetExtension(extension);
  const dataUrl = input.startsWith("data:") ? parseImageDataUrl(input) : null;
  const payload = dataUrl?.payload ?? input;
  const compact = payload.replace(/\s/g, "");
  if (!isCanonicalBase64(compact)) {
    throw invalidInput("Image data is not valid base64.");
  }
  return validateAssetBytes(
    Buffer.from(compact, "base64"),
    requestedExtension,
    dataUrl?.mime,
  );
}

export async function readValidatedAsset(
  assetRoot: string,
  path: string,
): Promise<ValidatedAsset> {
  const parts = safeAssetSegments(path);
  const contentType = parts ? assetContentType(parts.at(-1)!) : null;
  if (!parts || !contentType) throw invalidPath("Asset path is invalid.");
  const extension = normalizeAssetExtension(parts.at(-1)!.slice(parts.at(-1)!.lastIndexOf(".")));

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
    return await validateAssetBytes(await handle.readFile(), extension);
  } finally {
    await handle.close();
  }
}

async function validateAssetBytes(
  bytes: Buffer,
  requestedExtension: SupportedAssetExtension,
  dataUrlMime?: string,
): Promise<ValidatedAsset> {
  // Asset data crosses two serialized process seams, so reject oversized
  // payloads before they can become persistent memory pressure.
  if (bytes.byteLength === 0 || bytes.byteLength > 25 * 1024 * 1024) {
    throw invalidInput("Image data must be between 1 byte and 25 MiB.");
  }

  const detected = await fileTypeFromBuffer(bytes);
  if (!detected || !(detected.ext in supportedAssetTypes)) {
    throw invalidInput("Image bytes are not a supported PNG, JPEG, GIF, or WebP file.");
  }
  const detectedExtension = detected.ext as SupportedAssetExtension;
  const detectedMime = supportedAssetTypes[detectedExtension];
  if (requestedExtension !== detectedExtension) {
    throw invalidInput("Image extension does not match its file contents.");
  }
  if (dataUrlMime && dataUrlMime !== detectedMime) {
    throw invalidInput("Image data URL MIME type does not match its file contents.");
  }
  return { bytes, extension: detectedExtension, contentType: detectedMime };
}

export async function loadAssetResponse(
  assetRoot: string,
  requestUrl: string,
): Promise<Response> {
  const url = new URL(requestUrl);
  if (url.protocol !== "riffle-asset:" || url.hostname !== "vault") {
    throw invalidPath("Asset URL is outside the active Vault.");
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
  } catch {
    throw invalidPath("Asset URL is invalid.");
  }
  const asset = await readValidatedAsset(assetRoot, decoded);
  return new Response(new Uint8Array(asset.bytes), {
    headers: {
      "content-type": asset.contentType,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "access-control-allow-origin": "*",
    },
  });
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

export async function atomicWriteText(path: string, content: string): Promise<void> {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  let committed = false;
  try {
    await writeFile(temporary, content, { flag: "wx" });
    await rename(temporary, path);
    committed = true;
  } finally {
    if (!committed) await rm(temporary, { force: true }).catch(() => undefined);
  }
}

function normalizeAssetExtension(extension: string): SupportedAssetExtension {
  const normalized = extension.trim().replace(/^\./, "").toLowerCase();
  const aliased = normalized === "jpeg" ? "jpg" : normalized;
  if (!(aliased in supportedAssetTypes)) {
    // SVG stays rejected until a mature sanitizer can make active content safe.
    throw invalidInput(`Unsupported image type: ${normalized}`);
  }
  return aliased as SupportedAssetExtension;
}

function parseImageDataUrl(input: string): { mime: string; payload: string } {
  const matched = /^data:([^;,]+);base64,([\s\S]*)$/i.exec(input);
  if (!matched) throw invalidInput("Image data URL must use base64 encoding.");
  return { mime: matched[1]!.toLowerCase(), payload: matched[2]! };
}

function isCanonicalBase64(compact: string): boolean {
  // Buffer.from is deliberately permissive; validate first so malformed input
  // cannot be silently decoded into a different asset.
  return (
    compact.length > 0 &&
    compact.length % 4 === 0 &&
    /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      compact,
    )
  );
}

function assertContained(root: string, candidate: string): void {
  const offset = relative(root, candidate);
  if (offset && offset !== ".." && !offset.startsWith(`..${sep}`) && !isAbsolute(offset)) return;
  throw invalidPath("Path leaves its approved root.");
}

function invalidPath(message: string): NativeContentError {
  return new NativeContentError("INVALID_PATH", message);
}

function invalidInput(message: string): NativeContentError {
  return new NativeContentError("INVALID_INPUT", message);
}
