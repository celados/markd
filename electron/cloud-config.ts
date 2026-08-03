export type CloudConfig = {
  enabled: true;
  apiBase: string;
  siteOrigin: string;
};

export type CloudConfigResult =
  | { ok: true; value: CloudConfig }
  | { ok: false; message: string };

export function resolveCloudConfig(env: NodeJS.ProcessEnv): CloudConfigResult {
  // The Celados fork does not own usemarkd.app. Production Cloud must stay a
  // source-level closed gate until that ownership decision changes; inherited
  // upstream environment variables are not authority to publish user Notes.
  if (env.MARKD_CLOUD_TEST_MODE !== "1") {
    return {
      ok: false,
      message:
        "Cloud publishing is unavailable because this build has not verified ownership of its Cloud API and site.",
    };
  }
  const apiBase = parseOrigin(env.MARKD_CLOUD_API_BASE);
  const siteOrigin = parseOrigin(env.MARKD_CLOUD_SITE_ORIGIN);
  if (!apiBase || !siteOrigin || !isLoopback(apiBase) || !isLoopback(siteOrigin)) {
    return {
      ok: false,
      message: "Cloud publishing is unavailable because its trusted origins are invalid.",
    };
  }
  return { ok: true, value: { enabled: true, apiBase, siteOrigin } };
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
