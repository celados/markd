import { load } from "cheerio";
import { lookup } from "node:dns/promises";
import type { LookupFunction } from "node:net";
import ipaddr from "ipaddr.js";
import { Agent, fetch as undiciFetch, type Dispatcher } from "undici";

export type LinkMetadata = {
  title?: string;
  image?: string;
  favicon?: string;
};

const maximumDocumentBytes = 2 * 1024 * 1024;
const defaultMaximumRedirects = 5;

type MetadataFetchOptions = {
  fetch?: MetadataFetch;
  resolve?: (hostname: string, signal: AbortSignal) => Promise<string[]>;
  timeoutMs?: number;
  maximumRedirects?: number;
};

type ApprovedAddress = { address: string; family: 4 | 6 };
type MetadataFetch = (
  input: URL,
  init: RequestInit & { dispatcher?: Dispatcher },
) => Promise<Response>;

export class PinnedMetadataTransport {
  readonly #approved = new Map<string, ApprovedAddress>();
  readonly #agent: Agent;
  readonly #fetch: MetadataFetch;

  constructor(fetchImplementation: MetadataFetch = undiciFetch as unknown as MetadataFetch) {
    this.#fetch = fetchImplementation;
    const pinnedLookup: LookupFunction = (hostname, options, callback) => {
      const approved = this.#approved.get(normalizeHostname(hostname));
      if (!approved) {
        callback(Object.assign(new Error("Metadata transport has no approved address."), {
          code: "ENOTFOUND",
        }), "", 0);
        return;
      }
      if (options.all) {
        callback(null, [approved]);
        return;
      }
      callback(null, approved.address, approved.family);
    };
    this.#agent = new Agent({ connect: { lookup: pinnedLookup } });
  }

  bindApprovedDestination(hostname: string, addresses: readonly ApprovedAddress[]): void {
    const approved = addresses[0];
    if (!approved) throw new Error("Metadata transport requires an approved address.");
    // Pin one validated answer so the socket cannot perform a second DNS lookup
    // and route the same hostname to a private address.
    this.#approved.set(normalizeHostname(hostname), approved);
  }

  fetch(url: URL, init: RequestInit): Promise<Response> {
    return this.#fetch(url, { ...init, dispatcher: this.#agent });
  }

  async close(): Promise<void> {
    await this.#agent.destroy();
  }
}

export async function fetchLinkMetadata(
  url: string,
  options: MetadataFetchOptions = {},
): Promise<LinkMetadata> {
  const resolveHostname = options.resolve ?? resolveAll;
  const maximumRedirects = options.maximumRedirects ?? defaultMaximumRedirects;
  const signal = AbortSignal.timeout(options.timeoutMs ?? 10_000);
  const transport = new PinnedMetadataTransport(options.fetch);
  let current = parseHttpUrl(url);

  try {
    for (let redirects = 0; ; redirects += 1) {
      const addresses = await assertPublicDestination(current, resolveHostname, signal);
      transport.bindApprovedDestination(current.hostname, addresses);
      const response = await transport.fetch(current, {
        headers: { "user-agent": "Mozilla/5.0 (Macintosh) Markd/0.2" },
        redirect: "manual",
        signal,
      });
      if (isRedirect(response.status)) {
        const location = response.headers.get("location");
        if (redirects >= maximumRedirects) {
          await cancelResponseBody(response);
          throw new Error("Bookmark metadata request exceeded the redirect limit.");
        }
        if (!location) {
          await cancelResponseBody(response);
          throw new Error("Bookmark metadata redirect has no location.");
        }
        await cancelResponseBody(response);
        current = parseHttpUrl(new URL(location, current).toString());
        continue;
      }
      if (!response.ok) {
        await cancelResponseBody(response);
        throw new Error(`Bookmark metadata request failed (${response.status}).`);
      }
      const html = await readLimitedText(response);
      return parseLinkMetadata(html, new URL(response.url || current));
    }
  } finally {
    await transport.close();
  }
}

export function parseLinkMetadata(html: string, base: URL): LinkMetadata {
  const document = load(html);
  const content = (selector: string, attribute = "content") => {
    const value = document(selector).first().attr(attribute)?.trim();
    return value || undefined;
  };
  const title = content('meta[property="og:title"]') || document("title").first().text().trim() || undefined;
  const image = absoluteHttpUrl(
    content('meta[property="og:image"]') || content('meta[name="twitter:image"]'),
    base,
  );
  const favicon = absoluteHttpUrl(
    content('link[rel~="icon"]', "href") || content('link[rel="shortcut icon"]', "href") || "/favicon.ico",
    base,
  );
  return { title, image, favicon };
}

async function readLimitedText(response: Response): Promise<string> {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > maximumDocumentBytes) {
    await cancelResponseBody(response);
    throw new Error("Bookmark metadata response is too large.");
  }
  if (!response.body) return response.text();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > maximumDocumentBytes) {
        const error = new Error("Bookmark metadata response is too large.");
        await reader.cancel(error);
        throw error;
      }
      chunks.push(next.value);
    }
  } catch (error) {
    try {
      await reader.cancel(error);
    } catch {
      // Preserve the request failure; cancellation is only cleanup.
    }
    throw error;
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function absoluteHttpUrl(value: string | undefined, base: URL): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value, base);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function parseHttpUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Bookmark metadata URL is invalid.");
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("Bookmark metadata only accepts public HTTP(S) URLs.");
  }
  return url;
}

async function assertPublicDestination(
  url: URL,
  resolveHostname: (hostname: string, signal: AbortSignal) => Promise<string[]>,
  signal: AbortSignal,
): Promise<ApprovedAddress[]> {
  const hostname = normalizeHostname(url.hostname);
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new Error("Bookmark metadata rejected a non-public destination.");
  }
  const addresses = ipaddr.isValid(hostname)
    ? [hostname]
    : await raceAbort(resolveHostname(hostname, signal), signal);
  // Fetch may select any DNS answer, so a mixed public/private result cannot
  // safely inherit trust from only its public addresses.
  if (addresses.length === 0 || addresses.some((address) => !isPublicAddress(address))) {
    throw new Error("Bookmark metadata rejected a non-public destination.");
  }
  return addresses.map(approvedAddress);
}

function isPublicAddress(value: string): boolean {
  if (!ipaddr.isValid(value)) return false;
  const parsed = ipaddr.parse(value);
  const address = parsed instanceof ipaddr.IPv6 && parsed.isIPv4MappedAddress()
    ? parsed.toIPv4Address()
    : parsed;
  return address.range() === "unicast";
}

async function resolveAll(hostname: string): Promise<string[]> {
  return (await lookup(hostname, { all: true, verbatim: true })).map(({ address }) => address);
}

function approvedAddress(value: string): ApprovedAddress {
  const parsed = ipaddr.parse(value);
  const address = parsed instanceof ipaddr.IPv6 && parsed.isIPv4MappedAddress()
    ? parsed.toIPv4Address()
    : parsed;
  return { address: address.toString(), family: address.kind() === "ipv4" ? 4 : 6 };
}

function normalizeHostname(hostname: string): string {
  return hostname.replace(/^\[|\]$/g, "").toLowerCase();
}

async function raceAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw signal.reason;
  let rejectAbort!: (reason: unknown) => void;
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject;
  });
  const onAbort = () => rejectAbort(signal.reason);
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    return await Promise.race([operation, aborted]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

async function cancelResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Cleanup must not replace the policy or HTTP error that owns this path.
  }
}

function isRedirect(status: number): boolean {
  return [301, 302, 303, 307, 308].includes(status);
}
