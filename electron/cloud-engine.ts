import { createHash, randomUUID } from "node:crypto";
import { readFile, realpath, rm, stat } from "node:fs/promises";
import { isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import * as v from "valibot";
import {
  cloudAccountSchema,
  otpChallengeSchema,
  publishedShareSchema,
  type DesktopErrorData,
} from "./bridge-contract";
import {
  isTrustedCloudUrl,
  isTrustedUploadUrl,
  type CloudConfigResult,
} from "./cloud-config";
import { writeFileAtomically } from "./atomic-write";
import { NativeContentError, readValidatedAsset } from "./native-content";
import type {
  CloudAccount,
  CloudAccountStatus,
  OtpChallenge,
  PublishedNoteStatus,
  PublishedShare,
  PublishPageDraft,
} from "../src/lib/types";

// These routes and envelopes migrate the existing Rust desktop client and the
// in-repo Cloudflare service contract; they are not a new Electron protocol.
// Sources: src-tauri/src/cloud*.rs and services/cloud-api/src/{index,auth,otp,billing,publishing}.ts.

type Fetch = typeof globalThis.fetch;

type StoredSession = {
  accessToken: string;
  expiresAt: number;
  account: CloudAccount;
};

type CloudMetadata = {
  entries: Record<string, { entryId: string; share?: PublishedShare }>;
};

type PublishDraft = {
  rel: string;
  title: string;
  content: string;
  pages: PublishPageDraft[];
};

type PublishObject = {
  hash: string;
  kind: "page" | "asset";
  contentType: string;
  size: number;
};

type PreparedRelease = {
  manifest: {
    version: 1;
    rootEntryId: string;
    pages: Array<{ entryId: string; path: string; title: string; objectHash: string }>;
    objects: PublishObject[];
  };
  objects: Map<string, Uint8Array>;
};

const sessionSchema = v.object({
  accessToken: v.pipe(v.string(), v.minLength(1)),
  expiresAt: v.number(),
  account: cloudAccountSchema,
});

const sessionResponseSchema = v.object({
  accessToken: v.pipe(v.string(), v.minLength(1)),
  expiresAt: v.number(),
  user: cloudAccountSchema,
});

const accountResponseSchema = v.object({ user: cloudAccountSchema });
const billingUrlSchema = v.object({ url: v.pipe(v.string(), v.url()) });
const beginPublishSchema = v.object({
  sessionId: v.pipe(v.string(), v.minLength(1)),
  uploads: v.array(v.object({
    hash: v.pipe(v.string(), v.minLength(1)),
    url: v.pipe(v.string(), v.url()),
    headers: v.record(v.string(), v.string()),
  })),
});
const siteEnvelopeSchema = v.object({ site: publishedShareSchema });

export class CloudEngineError extends Error {
  readonly kind: string;
  readonly details?: unknown;

  constructor(error: DesktopErrorData) {
    super(error.message);
    this.name = "CloudEngineError";
    this.kind = error.kind;
    this.details = error.details;
  }
}

export class CloudEngine {
  readonly #sessionFile: string;
  readonly #root: () => string;
  readonly #config: CloudConfigResult;
  readonly #fetch: Fetch;

  constructor(
    configDir: string,
    root: () => string,
    config: CloudConfigResult,
    fetchImplementation: Fetch = globalThis.fetch,
  ) {
    this.#sessionFile = join(configDir, "cloud-session.json");
    this.#root = root;
    this.#config = config;
    this.#fetch = fetchImplementation;
  }

  async accountStatus(): Promise<CloudAccountStatus> {
    this.#requireConfig();
    const session = await this.#loadSession();
    if (!session) return { account: null };
    const response = await this.#request("/v1/me", { token: session.accessToken });
    if (response.status === 401) {
      await this.#clearSession();
      return { account: null };
    }
    await this.#expectSuccess(response);
    const account = await this.#json(response, accountResponseSchema).then((value) => value.user);
    await this.#saveSession({ ...session, account });
    return { account };
  }

  async requestOtp(email: string): Promise<OtpChallenge> {
    this.#requireConfig();
    const response = await this.#request("/v1/auth/otp/request", {
      method: "POST",
      json: { email },
    });
    await this.#expectSuccess(response);
    return this.#json(response, otpChallengeSchema);
  }

  async verifyOtp(challengeId: string, code: string): Promise<CloudAccount> {
    this.#requireConfig();
    const response = await this.#request("/v1/auth/otp/verify", {
      method: "POST",
      json: { challengeId, code },
    });
    await this.#expectSuccess(response);
    const verified = await this.#json(response, sessionResponseSchema);
    await this.#saveSession({
      accessToken: verified.accessToken,
      expiresAt: verified.expiresAt,
      account: verified.user,
    });
    return verified.user;
  }

  async signOut(): Promise<void> {
    this.#requireConfig();
    const session = await this.#loadSession();
    // The local credential store is authoritative: sign-out must take effect
    // even when remote revocation is unavailable. The tagged failure tells the
    // renderer to show the remote problem without rendering a stale login.
    await this.#clearSession();
    if (!session) return;
    try {
      const response = await this.#request("/v1/session", {
        method: "DELETE",
        token: session.accessToken,
      });
      await this.#expectSuccess(response);
    } catch (error) {
      if (error instanceof CloudEngineError) {
        throw new CloudEngineError({
          kind: error.kind,
          message: error.message,
          details: {
            ...(isRecord(error.details) ? error.details : {}),
            localSignedOut: true,
          },
        });
      }
      throw error;
    }
  }

  async plansUrl(): Promise<string> {
    this.#requireConfig();
    return this.#billingUrl("/v1/billing/handoffs");
  }

  async portalUrl(): Promise<string> {
    this.#requireConfig();
    return this.#billingUrl("/v1/billing/portal");
  }

  async status(draft: PublishDraft): Promise<PublishedNoteStatus> {
    this.#requireConfig();
    const metadata = await this.#readMetadata();
    const share = metadata.entries[draft.rel]?.share ?? null;
    const prepared = await this.#prepareRelease(
      draft,
      share?.title ?? draft.title,
      metadata,
      false,
    );
    const account = (await this.accountStatus()).account;
    return {
      account,
      share,
      isOutdated: Boolean(share && share.contentHash !== manifestHash(prepared)),
    };
  }

  async publish(draft: PublishDraft): Promise<PublishedShare> {
    this.#requireConfig();
    const metadata = await this.#readMetadata();
    if (metadata.entries[draft.rel]?.share) {
      throw cloudError("cloud", "This Note is already published.");
    }
    return this.#publishRelease(draft, metadata, undefined);
  }

  async update(draft: PublishDraft): Promise<PublishedShare> {
    this.#requireConfig();
    const metadata = await this.#readMetadata();
    const share = metadata.entries[draft.rel]?.share;
    if (!share) throw cloudError("not_found", "This Note is not published.");
    return this.#publishRelease(draft, metadata, share.id);
  }

  async revoke(rel: string): Promise<void> {
    this.#requireConfig();
    const metadata = await this.#readMetadata();
    const entry = metadata.entries[rel];
    if (!entry?.share) return;
    const token = await this.#accessToken();
    const response = await this.#request(`/v1/sites/${encodeURIComponent(entry.share.id)}`, {
      method: "DELETE",
      token,
    });
    await this.#expectSuccess(response);
    delete entry.share;
    await this.#writeMetadata(metadata);
  }

  async isPublished(rel: string): Promise<boolean> {
    return Boolean((await this.#readMetadata()).entries[rel]?.share);
  }

  async #publishRelease(
    draft: PublishDraft,
    metadata: CloudMetadata,
    siteId: string | undefined,
  ): Promise<PublishedShare> {
    const token = await this.#accessToken();
    const prepared = await this.#prepareRelease(draft, draft.title, metadata, true);
    const entry = metadata.entries[draft.rel]!;
    const response = await this.#request("/v1/publish-sessions", {
      method: "POST",
      token,
      json: {
        ...(siteId ? { siteId } : {}),
        entryId: entry.entryId,
        title: draft.title,
        manifest: prepared.manifest,
      },
    });
    await this.#expectSuccess(response);
    const session = await this.#json(response, beginPublishSchema);
    const uploads = session.uploads.map((upload) => {
      const object = prepared.objects.get(upload.hash);
      if (!object) throw cloudError("CLOUD_INVALID_RESPONSE", "The publishing service requested an unknown object.");
      if (!this.#config.ok || !isTrustedUploadUrl(upload.url, this.#config.value)) {
        throw cloudError(
          "CLOUD_UNTRUSTED_UPLOAD_URL",
          "The publishing service returned an untrusted object upload URL.",
        );
      }
      return { upload, object };
    });
    // Validate the complete upload plan before sending any Note or asset bytes;
    // otherwise a later malicious URL could fail after an earlier disclosure.
    for (const { upload, object } of uploads) {
      const uploadResponse = await this.#fetch(upload.url, {
        method: "PUT",
        headers: upload.headers,
        body: Buffer.from(object),
        // A 307/308 would otherwise replay private Note bytes to Location.
        redirect: "error",
        signal: AbortSignal.timeout(5 * 60 * 1000),
      }).catch(networkFailure);
      if (!uploadResponse.ok) {
        throw cloudError("CLOUD_REMOTE_ERROR", `A published object upload failed with ${uploadResponse.status}.`);
      }
    }
    const finalized = await this.#request(
      `/v1/publish-sessions/${encodeURIComponent(session.sessionId)}/finalize`,
      { method: "POST", token },
    );
    await this.#expectSuccess(finalized);
    const share = await this.#json(finalized, siteEnvelopeSchema).then((value) => value.site);
    if (!this.#trustedUrl(share.url) || share.entryId !== entry.entryId) {
      throw cloudError("CLOUD_INVALID_RESPONSE", "The publishing service returned an untrusted Published Share.");
    }
    share.contentHash = manifestHash(prepared);
    entry.share = share;
    await this.#writeMetadata(metadata);
    return share;
  }

  async #prepareRelease(
    draft: PublishDraft,
    title: string,
    metadata: CloudMetadata,
    persistEntries: boolean,
  ): Promise<PreparedRelease> {
    const root = this.#root();
    const objects = new Map<string, Uint8Array>();
    const descriptors = new Map<string, PublishObject>();
    const pages: PreparedRelease["manifest"]["pages"] = [];
    const drafts = [
      { rel: draft.rel, path: "", title, markdown: draft.content },
      ...draft.pages,
    ];
    for (const page of drafts) {
      await assertNote(root, page.rel);
      let entry = metadata.entries[page.rel];
      if (!entry) {
        entry = { entryId: `entry_${randomUUID().replaceAll("-", "")}` };
        metadata.entries[page.rel] = entry;
      }
      const markdown = await rewriteAssets(root, page.markdown, objects, descriptors);
      const bytes = Buffer.from(markdown);
      const hash = hashBytes(bytes);
      objects.set(hash, bytes);
      descriptors.set(hash, {
        hash,
        kind: "page",
        contentType: "text/markdown; charset=utf-8",
        size: bytes.byteLength,
      });
      pages.push({ entryId: entry.entryId, path: page.path, title: page.title, objectHash: hash });
    }
    if (persistEntries) await this.#writeMetadata(metadata);
    return {
      manifest: {
        version: 1,
        rootEntryId: pages[0]!.entryId,
        pages,
        objects: [...descriptors.values()],
      },
      objects,
    };
  }

  async #billingUrl(path: string): Promise<string> {
    const response = await this.#request(path, {
      method: "POST",
      token: await this.#accessToken(),
    });
    await this.#expectSuccess(response);
    const url = await this.#json(response, billingUrlSchema).then((value) => value.url);
    if (!this.#trustedUrl(url)) {
      throw cloudError("CLOUD_UNTRUSTED_URL", "Markd Cloud returned an untrusted external URL.");
    }
    return url;
  }

  async #request(
    path: string,
    options: { method?: string; token?: string; json?: unknown } = {},
  ): Promise<Response> {
    if (!this.#config.ok) {
      throw cloudError("CLOUD_OWNERSHIP_UNVERIFIED", this.#config.message);
    }
    const headers = new Headers({ "user-agent": "Markd Electron" });
    if (options.token) headers.set("authorization", `Bearer ${options.token}`);
    if (options.json !== undefined) headers.set("content-type", "application/json");
    return this.#fetch(`${this.#config.value.apiBase}${path}`, {
      method: options.method ?? "GET",
      headers,
      body: options.json === undefined ? undefined : JSON.stringify(options.json),
      // Redirect following would move Bearer credentials or request JSON beyond
      // the source-level trusted API origin validated by CloudConfig.
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
    }).catch(networkFailure);
  }

  async #expectSuccess(response: Response): Promise<void> {
    if (response.ok) return;
    let input: unknown;
    try {
      input = await response.json();
    } catch {
      input = null;
    }
    const error = input && typeof input === "object" && "error" in input
      ? (input as { error?: unknown }).error
      : null;
    const record = error && typeof error === "object" ? error as Record<string, unknown> : {};
    const code = typeof record.code === "string" ? record.code : "cloud_remote_error";
    const message = typeof record.message === "string"
      ? record.message
      : `Markd Cloud returned ${response.status}.`;
    const kind = response.status === 401
      ? "cloud_login_required"
      : response.status === 402
        ? "cloud_subscription_required"
        : "cloud";
    throw cloudError(kind, message, { status: response.status, code, remote: record.details });
  }

  async #json<T>(response: Response, schema: v.GenericSchema<unknown, T>): Promise<T> {
    let input: unknown;
    try {
      input = await response.json();
    } catch {
      throw cloudError("CLOUD_INVALID_RESPONSE", "Markd Cloud returned invalid JSON.");
    }
    const parsed = v.safeParse(schema, input);
    if (!parsed.success) {
      throw cloudError("CLOUD_INVALID_RESPONSE", "Markd Cloud returned an invalid response.");
    }
    return parsed.output;
  }

  async #accessToken(): Promise<string> {
    const session = await this.#loadSession();
    if (!session) throw cloudError("cloud_login_required", "Sign in to Markd before publishing a Note.");
    return session.accessToken;
  }

  async #loadSession(): Promise<StoredSession | null> {
    let text: string;
    try {
      text = await readFile(this.#sessionFile, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw cloudError("CLOUD_SESSION_ERROR", "The Cloud session could not be read.");
    }
    let input: unknown;
    try {
      input = JSON.parse(text);
    } catch {
      throw cloudError("CLOUD_SESSION_ERROR", "The Cloud session is invalid.");
    }
    const parsed = v.safeParse(sessionSchema, input);
    if (!parsed.success) throw cloudError("CLOUD_SESSION_ERROR", "The Cloud session is invalid.");
    if (parsed.output.expiresAt <= Date.now()) {
      await this.#clearSession();
      return null;
    }
    return parsed.output;
  }

  async #saveSession(session: StoredSession): Promise<void> {
    await writeFileAtomically(
      this.#sessionFile,
      `${JSON.stringify(session, null, 2)}\n`,
      0o600,
    );
  }

  async #clearSession(): Promise<void> {
    await rm(this.#sessionFile, { force: true });
  }

  async #readMetadata(): Promise<CloudMetadata> {
    const path = this.#metadataFile();
    try {
      const input: unknown = JSON.parse(await readFile(path, "utf8"));
      if (!input || typeof input !== "object" || !("entries" in input)) {
        throw new Error("invalid");
      }
      const entries = (input as { entries?: unknown }).entries;
      if (!entries || typeof entries !== "object" || Array.isArray(entries)) throw new Error("invalid");
      const result: CloudMetadata = { entries: {} };
      for (const [rel, raw] of Object.entries(entries)) {
        if (!raw || typeof raw !== "object") throw new Error("invalid");
        const entryId = (raw as { entryId?: unknown }).entryId;
        const share = (raw as { share?: unknown }).share;
        if (typeof entryId !== "string" || !entryId) throw new Error("invalid");
        const parsedShare = share === undefined ? undefined : v.safeParse(publishedShareSchema, share);
        if (parsedShare && !parsedShare.success) throw new Error("invalid");
        result.entries[rel] = { entryId, ...(parsedShare ? { share: parsedShare.output } : {}) };
      }
      return result;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { entries: {} };
      throw cloudError("CLOUD_METADATA_INVALID", "The Vault Cloud metadata is invalid.");
    }
  }

  async #writeMetadata(metadata: CloudMetadata): Promise<void> {
    const path = this.#metadataFile();
    await writeFileAtomically(path, `${JSON.stringify(metadata, null, 2)}\n`);
  }

  #metadataFile(): string {
    return join(this.#root(), ".markd", "cloud.json");
  }

  #trustedUrl(url: string): boolean {
    return this.#config.ok && isTrustedCloudUrl(url, this.#config.value);
  }

  #requireConfig(): void {
    if (!this.#config.ok) {
      throw cloudError("CLOUD_OWNERSHIP_UNVERIFIED", this.#config.message);
    }
  }
}

async function assertNote(root: string, rel: string): Promise<void> {
  const candidate = resolveVaultPath(root, rel);
  let canonical: string;
  try {
    canonical = await realpath(candidate);
  } catch {
    throw cloudError("not_found", `Note does not exist: ${rel}`);
  }
  if (
    normalize(canonical) !== normalize(candidate) ||
    !(await stat(canonical)).isFile() ||
    !canonical.endsWith(".md")
  ) {
    throw cloudError("invalid_path", `Invalid Note path: ${rel}`);
  }
}

function resolveVaultPath(root: string, rel: string): string {
  if (!rel || rel.split(/[\\/]/).some((part) => !part || part === "." || part === ".." || part.startsWith("."))) {
    throw cloudError("invalid_path", `Invalid Note path: ${rel}`);
  }
  const candidate = resolve(root, ...rel.split(/[\\/]/));
  const offset = relative(root, candidate);
  if (offset === "" || offset === ".." || offset.startsWith(`..${sep}`) || isAbsolute(offset)) {
    throw cloudError("invalid_path", `Invalid Note path: ${rel}`);
  }
  return candidate;
}

async function rewriteAssets(
  root: string,
  markdown: string,
  objects: Map<string, Uint8Array>,
  descriptors: Map<string, PublishObject>,
): Promise<string> {
  const image = /!\[[^\]]*\]\(\s*(?<href><[^>]+>|[^)\s]+)/g;
  const replacements: Array<{ start: number; end: number; value: string }> = [];
  for (const match of markdown.matchAll(image)) {
    const href = match.groups?.href;
    const index = match.index;
    if (!href || index === undefined) continue;
    const normalized = href.replace(/^<|>$/g, "").replace(/^\//, "");
    if (/^(?:#|\/\/|data:|[a-z][a-z0-9+.-]*:)/i.test(normalized)) continue;
    if (!normalized.startsWith(".markd/assets/")) {
      throw cloudError("INVALID_PUBLISH_ASSET", `Published images must be stored in .markd/assets: ${href}`);
    }
    const asset = await readValidatedAsset(
      join(root, ".markd", "assets"),
      normalized.slice(".markd/assets/".length),
    ).catch((error: unknown) => {
      if (error instanceof NativeContentError) {
        throw cloudError(
          "INVALID_PUBLISH_ASSET",
          `Published image is invalid: ${href}`,
          { kind: error.kind },
        );
      }
      throw error;
    });
    const { bytes, contentType } = asset;
    const hash = hashBytes(bytes);
    objects.set(hash, bytes);
    descriptors.set(hash, { hash, kind: "asset", contentType, size: bytes.byteLength });
    const hrefOffset = match[0].indexOf(href);
    replacements.push({
      start: index + hrefOffset,
      end: index + hrefOffset + href.length,
      value: `markd-asset:${hash}`,
    });
  }
  let result = markdown;
  for (const replacement of replacements.reverse()) {
    result = `${result.slice(0, replacement.start)}${replacement.value}${result.slice(replacement.end)}`;
  }
  return result;
}

function manifestHash(prepared: PreparedRelease): string {
  return hashBytes(Buffer.from(JSON.stringify(prepared.manifest)));
}

function hashBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function networkFailure(error: unknown): never {
  throw cloudError(
    "network",
    error instanceof Error ? error.message : "Markd Cloud could not be reached.",
  );
}

function cloudError(kind: string, message: string, details?: unknown): CloudEngineError {
  return new CloudEngineError({ kind, message, details });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
