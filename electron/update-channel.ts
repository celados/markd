export function resolveE2eUpdateChannel(
  input: string | undefined,
  backgroundE2e: boolean,
): string | null {
  if (!input || !backgroundE2e) return null;
  const url = new URL(input);
  const loopback = new Set(["127.0.0.1", "::1", "localhost"]);
  if (!loopback.has(url.hostname) || !["http:", "https:"].includes(url.protocol)) {
    throw new Error("The E2E update channel must use an HTTP(S) loopback URL.");
  }
  url.username = "";
  url.password = "";
  return url.toString();
}
