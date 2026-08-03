import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import {
  consumeReleaseE2eState,
  prepareReleaseE2eState,
  readReleaseE2eState,
} from "../electron/release-e2e-state";

const scratch: string[] = [];

afterEach(async () => {
  await Promise.all(scratch.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

test("release E2E state survives an in-place bundle replacement and is consumed", async () => {
  const root = await fixtureRoot();
  const executable = join(root, "Markd.app", "Contents", "MacOS", "Markd");
  const markerPath = join(root, "evidence.json");
  const state = prepareReleaseE2eState({
    MARKD_E2E_BACKGROUND: "1",
    MARKD_E2E_EXPECTED_VERSION: "0.2.0",
    MARKD_E2E_RELEASE_MARKER: markerPath,
    MARKD_E2E_STATE_ROOT: root,
    MARKD_TEST_CONFIG_DIR: join(root, "config"),
  }, executable, 1_000);

  expect(readReleaseE2eState(executable, 2_000)).toEqual(state);
  consumeReleaseE2eState(executable, state!.nonce, 2_000);
  expect(readReleaseE2eState(executable, 2_000)).toBeNull();
});

test("release E2E state rejects arbitrary roots and expired evidence", async () => {
  const root = await fixtureRoot();
  const executable = join(root, "Markd.app", "Contents", "MacOS", "Markd");
  expect(() => prepareReleaseE2eState({
    MARKD_E2E_BACKGROUND: "1",
    MARKD_E2E_EXPECTED_VERSION: "0.2.0",
    MARKD_E2E_RELEASE_MARKER: join(root, "evidence.json"),
    MARKD_E2E_STATE_ROOT: join(root, "wrong"),
    MARKD_TEST_CONFIG_DIR: join(root, "config"),
  }, executable)).toThrow(/isolated installed-app/u);

  prepareReleaseE2eState({
    MARKD_E2E_BACKGROUND: "1",
    MARKD_E2E_EXPECTED_VERSION: "0.2.0",
    MARKD_E2E_RELEASE_MARKER: join(root, "evidence.json"),
    MARKD_E2E_STATE_ROOT: root,
    MARKD_TEST_CONFIG_DIR: join(root, "config"),
  }, executable, 1_000);
  expect(readReleaseE2eState(executable, 1_000 + 15 * 60_000)).toBeNull();
});

async function fixtureRoot() {
  const parent = await mkdtemp(join(tmpdir(), "markd-release-e2e-state-"));
  scratch.push(parent);
  const root = join(parent, "markd-release-e2e-local-fixture");
  await mkdir(join(root, "Markd.app", "Contents", "MacOS"), { recursive: true });
  return root;
}
