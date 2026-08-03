import { randomUUID } from "node:crypto";
import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";

const stateFileName = ".markd-release-e2e.json";
const rootPrefix = "markd-release-e2e-";
const maximumLifetimeMs = 15 * 60_000;

export type ReleaseE2eState = {
  configDir: string;
  expectedVersion: string;
  installedApp: string;
  executable: string;
  markerPath: string;
  expiresAt: number;
  nonce: string;
};

export function prepareReleaseE2eState(
  env: NodeJS.ProcessEnv,
  executable: string,
  now = Date.now(),
): ReleaseE2eState | null {
  if (env.MARKD_E2E_BACKGROUND !== "1") return null;
  const expectedVersion = env.MARKD_E2E_EXPECTED_VERSION;
  const markerPath = env.MARKD_E2E_RELEASE_MARKER;
  const configDir = env.MARKD_TEST_CONFIG_DIR;
  const stateRoot = env.MARKD_E2E_STATE_ROOT;
  if (!expectedVersion || !markerPath || !configDir || !stateRoot) return null;
  const location = releaseE2eLocation(executable);
  if (
    normalize(stateRoot) !== normalize(location.root) ||
    !location.root.split("/").pop()?.startsWith(rootPrefix) ||
    normalize(dirname(markerPath)) !== normalize(location.root) ||
    normalize(configDir) !== normalize(join(location.root, "config")) ||
    !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(expectedVersion)
  ) {
    throw new Error("Release E2E state must be scoped to the isolated installed-app directory.");
  }
  const state: ReleaseE2eState = {
    configDir,
    expectedVersion,
    installedApp: location.app,
    executable,
    markerPath,
    expiresAt: now + maximumLifetimeMs,
    nonce: randomUUID(),
  };
  writeFileSync(location.state, JSON.stringify(state), { mode: 0o600 });
  return state;
}

export function readReleaseE2eState(
  executable: string,
  now = Date.now(),
): ReleaseE2eState | null {
  const location = releaseE2eLocation(executable);
  if (!location.root.split("/").pop()?.startsWith(rootPrefix)) return null;
  let input: unknown;
  try {
    input = JSON.parse(readFileSync(location.state, "utf8"));
  } catch {
    return null;
  }
  if (!isReleaseE2eState(input)) return null;
  if (
    normalize(input.installedApp) !== normalize(location.app) ||
    normalize(input.executable) !== normalize(executable) ||
    normalize(dirname(input.markerPath)) !== normalize(location.root) ||
    normalize(input.configDir) !== normalize(join(location.root, "config")) ||
    input.expiresAt <= now ||
    input.expiresAt > now + maximumLifetimeMs
  ) {
    return null;
  }
  return input;
}

export function consumeReleaseE2eState(
  executable: string,
  nonce: string,
  now = Date.now(),
): void {
  const state = readReleaseE2eState(executable, now);
  if (!state || state.nonce !== nonce) {
    throw new Error("Release E2E state changed before relaunch evidence was committed.");
  }
  unlinkSync(releaseE2eLocation(executable).state);
}

function releaseE2eLocation(executable: string) {
  const contents = dirname(dirname(executable));
  const app = dirname(contents);
  const root = dirname(app);
  return { app, root, state: join(root, stateFileName) };
}

function isReleaseE2eState(input: unknown): input is ReleaseE2eState {
  if (!input || typeof input !== "object" || Array.isArray(input)) return false;
  const value = input as Record<string, unknown>;
  return (
    Object.keys(value).sort().join(",") ===
      "configDir,executable,expectedVersion,expiresAt,installedApp,markerPath,nonce" &&
    typeof value.configDir === "string" &&
    typeof value.expectedVersion === "string" &&
    typeof value.installedApp === "string" &&
    typeof value.executable === "string" &&
    typeof value.markerPath === "string" &&
    typeof value.expiresAt === "number" &&
    typeof value.nonce === "string" &&
    /^[0-9a-f]{8}-[0-9a-f-]{27}$/iu.test(value.nonce)
  );
}
