export type CloudConfig = {
  enabled: true;
  apiBase: string;
  siteOrigin: string;
  allowLoopbackHttp: boolean;
};

export type CloudConfigResult =
  | { ok: true; value: CloudConfig }
  | { ok: false; message: string };

export function resolveCloudConfig(env: NodeJS.ProcessEnv): CloudConfigResult {
  // Riffle does not own usemarkd.app. Production Cloud must stay a
  // source-level closed gate until that ownership decision changes; inherited
  // upstream environment variables are not authority to publish user Notes.
  if (env.RIFFLE_CLOUD_TEST_MODE !== "1") {
    return {
      ok: false,
      message:
        "Cloud publishing is unavailable because this build has not verified ownership of its Cloud API and site.",
    };
  }
  const apiBase = parseOrigin(env.RIFFLE_CLOUD_API_BASE);
  const siteOrigin = parseOrigin(env.RIFFLE_CLOUD_SITE_ORIGIN);
  if (!apiBase || !siteOrigin || !isLoopback(apiBase) || !isLoopback(siteOrigin)) {
    return {
      ok: false,
      message: "Cloud publishing is unavailable because its trusted origins are invalid.",
    };
  }
  return {
    ok: true,
    value: { enabled: true, apiBase, siteOrigin, allowLoopbackHttp: true },
  };
}

function isLoopback(origin: string): boolean {
  return ["127.0.0.1", "localhost", "::1"].includes(new URL(origin).hostname);
}

export function isTrustedCloudUrl(url: string, config: CloudConfig): boolean {
  try {
    const parsed = new URL(url);
    return parsed.origin === config.siteOrigin && trustedProtocol(parsed);
  } catch {
    return false;
  }
}

export function isTrustedUploadUrl(url: string, config: CloudConfig): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.username || parsed.password) return false;
    if (parsed.protocol === "https:") return true;
    return (
      parsed.protocol === "http:" &&
      config.allowLoopbackHttp &&
      ["127.0.0.1", "localhost", "::1"].includes(parsed.hostname)
    );
  } catch {
    return false;
  }
}

function parseOrigin(input: string | undefined): string | null {
  if (!input) return null;
  try {
    const url = new URL(input);
    if (!trustedProtocol(url) || url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function trustedProtocol(url: URL): boolean {
  return (
    url.protocol === "https:" ||
    (url.protocol === "http:" && ["127.0.0.1", "localhost", "::1"].includes(url.hostname))
  );
}
