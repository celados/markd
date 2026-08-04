import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import {
  prepareUpdaterHygiene,
  resolveUpdaterHygienePaths,
  restoreUpdaterHygiene,
  type UpdaterHygieneOptions,
} from "../scripts/updater-hygiene.mjs";

const scratch: string[] = [];

afterEach(async () => {
  await Promise.all(scratch.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

test("updater hygiene resolves only exact Riffle cache, ShipIt, and user-data paths", async () => {
  const fixture = await hygieneFixture("riffle-updater");
  const canonicalParent = await realpath(fixture.parent);
  expect(resolveUpdaterHygienePaths(
    fixture.app,
    fixture.root,
    fixture.backup,
    fixture.options,
  )).toMatchObject({
    allowedParent: canonicalParent,
    temporaryRoot: await realpath(fixture.temporaryRoot),
    updaterCache: join(fixture.home, "Library", "Caches", "riffle-updater"),
    shipItCache: join(fixture.home, "Library", "Caches", "app.usemarkd.ShipIt"),
    updaterId: join(canonicalParent, "riffle-release-e2e-local-fixture", "config", ".updaterId"),
    launchdLabel: "app.usemarkd.ShipIt",
    preferencesDomain: "app.usemarkd.ShipIt",
  });
});

test("updater hygiene accepts the released Markd cache during the rename upgrade", async () => {
  const fixture = await hygieneFixture("markd-updater", {}, "Markd.app");
  expect(resolveUpdaterHygienePaths(
    fixture.app,
    fixture.root,
    fixture.backup,
    fixture.options,
  )).toMatchObject({
    appPath: await realpath(fixture.app),
    updaterCacheName: "markd-updater",
    updaterCache: join(fixture.home, "Library", "Caches", "markd-updater"),
  });
});

test.each(["../escape", "riffle-updater-old", "app.usemarkd.ShipIt"])(
  "updater hygiene rejects an unexpected cache contract: %s",
  async (name) => {
    const fixture = await hygieneFixture(name);
    expect(() => resolveUpdaterHygienePaths(
      fixture.app,
      fixture.root,
      fixture.backup,
      fixture.options,
    )).toThrow(/updaterCacheDirName/u);
  },
);

test("prepare and restore roundtrip exact updater state and remove only new ShipIt temp entries", async () => {
  const fixture = await hygieneFixture("riffle-updater");
  const paths = resolveUpdaterHygienePaths(
    fixture.app,
    fixture.root,
    fixture.backup,
    fixture.options,
  );
  await mkdir(paths.updaterCache, { recursive: true });
  await mkdir(paths.shipItCache, { recursive: true });
  await mkdir(join(fixture.root, "config"), { recursive: true });
  await writeFile(join(paths.updaterCache, "old"), "updater-before");
  await writeFile(join(paths.shipItCache, "old"), "shipit-before");
  await writeFile(paths.updaterId, "id-before");
  await mkdir(join(fixture.temporaryRoot, "app.usemarkd.ShipIt.before"));

  prepareUpdaterHygiene(fixture.app, fixture.root, fixture.backup, fixture.options);
  await mkdir(paths.updaterCache, { recursive: true });
  await writeFile(join(paths.updaterCache, "new"), "updater-after");
  await mkdir(join(fixture.temporaryRoot, "app.usemarkd.ShipIt.after"));
  await mkdir(join(fixture.temporaryRoot, "unrelated.after"));
  restoreUpdaterHygiene(fixture.backup, fixture.options);

  await expect(readFile(join(paths.updaterCache, "old"), "utf8")).resolves.toBe("updater-before");
  await expect(readFile(join(paths.shipItCache, "old"), "utf8")).resolves.toBe("shipit-before");
  await expect(readFile(paths.updaterId, "utf8")).rejects.toThrow();
  // Directories prove the old ShipIt entry and unrelated new entry remain without relying on broad cleanup.
  await expect(stat(join(fixture.temporaryRoot, "app.usemarkd.ShipIt.before"))).resolves.toBeTruthy();
  await expect(stat(join(fixture.temporaryRoot, "app.usemarkd.ShipIt.after"))).rejects.toThrow();
  await expect(stat(join(fixture.temporaryRoot, "unrelated.after"))).resolves.toBeTruthy();
  await expect(stat(fixture.root)).rejects.toThrow();
});

test("prepare rejects an existing system ShipIt launchd job", async () => {
  const fixture = await hygieneFixture("riffle-updater", { systemJob: true });
  expect(() => prepareUpdaterHygiene(
    fixture.app,
    fixture.root,
    fixture.backup,
    fixture.options,
  )).toThrow(/launchd job is already loaded/u);
});

test("prepare and restore export, clear, and re-import existing currentHost preferences", async () => {
  const fixture = await hygieneFixture("riffle-updater", { preferences: true });
  prepareUpdaterHygiene(fixture.app, fixture.root, fixture.backup, fixture.options);
  expect(fixture.commandState.preferences).toBe(false);
  fixture.commandState.userJob = true;
  restoreUpdaterHygiene(fixture.backup, fixture.options);
  expect(fixture.commandState.preferences).toBe(true);
  expect(fixture.commandState.userJob).toBe(false);
  expect(fixture.commandState.preferenceCommands).toEqual([
    "read", "export", "delete", "read", "delete", "read", "import", "read",
  ]);
});

test("restore rejects tampered state instead of deleting attacker-selected paths", async () => {
  const fixture = await hygieneFixture("riffle-updater");
  prepareUpdaterHygiene(fixture.app, fixture.root, fixture.backup, fixture.options);
  const statePath = join(fixture.backup, "state.json");
  const state = JSON.parse(await readFile(statePath, "utf8"));
  state.updaterCache = join(fixture.parent, "do-not-delete");
  await writeFile(statePath, JSON.stringify(state));
  expect(() => restoreUpdaterHygiene(fixture.backup, fixture.options)).toThrow(
    /invalid restore target: updaterCache/u,
  );
});

async function hygieneFixture(
  cacheName: string,
  initial: { preferences?: boolean; systemJob?: boolean } = {},
  appName = "Riffle.app",
) {
  const parent = await mkdtemp(join(tmpdir(), "riffle-hygiene-fixture-"));
  scratch.push(parent);
  const root = join(parent, "riffle-release-e2e-local-fixture");
  const app = join(root, appName);
  const backup = join(parent, "riffle-updater-backup-fixture");
  const home = join(parent, "home");
  const temporaryRoot = join(parent, "native-temp");
  await mkdir(join(app, "Contents", "Resources"), { recursive: true });
  await mkdir(temporaryRoot);
  await writeFile(
    join(app, "Contents", "Resources", "app-update.yml"),
    `updaterCacheDirName: ${JSON.stringify(cacheName)}\n`,
  );
  const commandState = {
    preferences: initial.preferences ?? false,
    systemJob: initial.systemJob ?? false,
    userJob: false,
    preferenceCommands: [] as string[],
  };
  const spawnSyncImpl: NonNullable<UpdaterHygieneOptions["spawnSyncImpl"]> = (command, args) => {
    if (command === "/usr/libexec/PlistBuddy") {
      return { status: 0, stdout: "app.usemarkd\n", stderr: "" };
    }
    if (command === "ps") return { status: 0, stdout: "", stderr: "" };
    if (command === "launchctl" && args[0] === "print") {
      return {
        status:
          (commandState.systemJob && args[1] === "system/app.usemarkd.ShipIt") ||
          (commandState.userJob && args[1]?.endsWith("/app.usemarkd.ShipIt"))
            ? 0
            : 113,
        stdout: "",
        stderr: "",
      };
    }
    if (command === "launchctl" && args[0] === "bootout") {
      if (args[1] === "system/app.usemarkd.ShipIt") commandState.systemJob = false;
      else commandState.userJob = false;
      return { status: 0, stdout: "", stderr: "" };
    }
    if (command === "defaults") {
      commandState.preferenceCommands.push(args[1] ?? "");
      if (args[1] === "read") {
        return { status: commandState.preferences ? 0 : 1, stdout: "", stderr: "" };
      }
      if (args[1] === "delete") commandState.preferences = false;
      if (args[1] === "import") commandState.preferences = true;
      return { status: 0, stdout: "", stderr: "" };
    }
    return { status: 0, stdout: "", stderr: "" };
  };
  const options = { home, runnerTemp: parent, temporaryRoot, spawnSyncImpl };
  return { parent, root, app, backup, home, temporaryRoot, options, commandState };
}
