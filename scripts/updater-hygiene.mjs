import {
  accessSync,
  constants,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, normalize, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { parse } from "yaml";

const bundleId = "app.usemarkd";
const shipItLabel = `${bundleId}.ShipIt`;
const updaterCacheNames = new Set(["markd-updater", "riffle-updater"]);
const stateFileName = "state.json";

export function resolveUpdaterHygienePaths(
  appPath,
  stateRoot,
  backupRoot,
  options = {},
) {
  const resolvedApp = realpathSync(resolve(appPath));
  const resolvedStateRoot = realpathSync(resolve(stateRoot));
  const resolvedBackupRoot = canonicalizePendingPath(backupRoot);
  const home = resolve(options.home ?? homedir());
  const temporaryRoot = realpathSync(resolve(options.temporaryRoot ?? tmpdir()));
  const allowedParent = realpathSync(resolve(options.runnerTemp ?? process.env.RUNNER_TEMP ?? temporaryRoot));
  if (
    normalize(dirname(resolvedApp)) !== normalize(resolvedStateRoot) ||
    !basename(resolvedStateRoot).startsWith("riffle-release-e2e-") ||
    !basename(resolvedBackupRoot).startsWith("riffle-updater-backup-") ||
    !isContainedBy(realpathSync(resolvedStateRoot), allowedParent) ||
    !isContainedBy(realpathSync(dirname(resolvedBackupRoot)), allowedParent)
  ) {
    throw new Error("Updater hygiene paths must stay inside the isolated release roots.");
  }
  const configPath = join(resolvedApp, "Contents", "Resources", "app-update.yml");
  const config = parse(readFileSync(configPath, "utf8"));
  const updaterCacheName = config?.updaterCacheDirName;
  if (!updaterCacheNames.has(updaterCacheName)) {
    throw new Error("Packaged updaterCacheDirName must belong to the released rename lineage.");
  }
  const cacheRoot = join(home, "Library", "Caches");
  return {
    appPath: resolvedApp,
    stateRoot: resolvedStateRoot,
    backupRoot: resolvedBackupRoot,
    allowedParent,
    temporaryRoot,
    configPath,
    updaterCacheName,
    updaterCache: join(cacheRoot, updaterCacheName),
    shipItCache: join(cacheRoot, shipItLabel),
    updaterId: join(resolvedStateRoot, "config", ".updaterId"),
    launchdLabel: shipItLabel,
    preferencesDomain: shipItLabel,
  };
}

export function prepareUpdaterHygiene(appPath, stateRoot, backupRoot, options = {}) {
  const paths = resolveUpdaterHygienePaths(appPath, stateRoot, backupRoot, options);
  if (existsSync(paths.backupRoot)) {
    throw new Error(`Updater hygiene backup already exists: ${paths.backupRoot}`);
  }
  // Squirrel replaces the app in place; checking an ancestor would hide a privileged install target.
  accessSync(paths.appPath, constants.W_OK);
  accessSync(paths.stateRoot, constants.W_OK);
  assertBundleId(paths.appPath, options);
  assertNoProductProcess(options);
  if (
    launchdJobExists(`gui/${process.getuid()}`, paths.launchdLabel, options) ||
    launchdJobExists("system", paths.launchdLabel, options)
  ) {
    throw new Error(`Updater launchd job is already loaded: ${paths.launchdLabel}`);
  }

  const state = {
    ...paths,
    hadUpdaterCache: existsSync(paths.updaterCache),
    hadShipItCache: existsSync(paths.shipItCache),
    hadUpdaterId: existsSync(paths.updaterId),
    hadPreferences: preferencesExist(paths.preferencesDomain, options),
    shipItTemporaryEntries: listShipItTemporaryEntries(paths.temporaryRoot),
  };
  mkdirSync(paths.backupRoot, { recursive: false, mode: 0o700 });
  writeFileSync(join(paths.backupRoot, stateFileName), JSON.stringify(state), { mode: 0o600 });
  try {
    if (state.hadPreferences) {
      run("defaults", [
        "-currentHost",
        "export",
        paths.preferencesDomain,
        join(paths.backupRoot, "preferences.plist"),
      ], options);
    }
    moveIfPresent(paths.updaterCache, join(paths.backupRoot, "updater-cache"));
    moveIfPresent(paths.shipItCache, join(paths.backupRoot, "shipit-cache"));
    moveIfPresent(paths.updaterId, join(paths.backupRoot, "updater-id"));
    clearPreferences(paths.preferencesDomain, options);
    return state;
  } catch (error) {
    restoreUpdaterHygiene(paths.backupRoot, options);
    throw error;
  }
}

export function restoreUpdaterHygiene(backupRoot, options = {}) {
  const resolvedBackupRoot = canonicalizePendingPath(backupRoot);
  if (!basename(resolvedBackupRoot).startsWith("riffle-updater-backup-")) {
    throw new Error("Updater hygiene restore rejected an invalid backup root.");
  }
  if (!existsSync(resolvedBackupRoot)) return;
  const state = JSON.parse(readFileSync(join(resolvedBackupRoot, stateFileName), "utf8"));
  const expected = deriveRestorePaths(
    state.stateRoot,
    resolvedBackupRoot,
    basename(state.appPath),
    state.updaterCacheName,
    options,
  );
  for (const key of Object.keys(expected)) {
    if (state[key] !== expected[key]) {
      throw new Error(`Updater hygiene backup contains invalid restore target: ${key}`);
    }
  }
  if (!Array.isArray(state.shipItTemporaryEntries) ||
      state.shipItTemporaryEntries.some((name) => !isShipItTemporaryName(name))) {
    throw new Error("Updater hygiene backup contains an invalid ShipIt temporary snapshot.");
  }

  bootoutLaunchdJob(state.launchdLabel, options);
  clearPreferences(state.preferencesDomain, options);
  if (state.hadPreferences) {
    run("defaults", [
      "-currentHost",
      "import",
      state.preferencesDomain,
      join(resolvedBackupRoot, "preferences.plist"),
    ], options);
    if (!preferencesExist(state.preferencesDomain, options)) {
      throw new Error(`Updater preferences were not restored: ${state.preferencesDomain}`);
    }
  }
  removeNewShipItTemporaryEntries(state.temporaryRoot, state.shipItTemporaryEntries);
  rmSync(state.updaterCache, { recursive: true, force: true });
  rmSync(state.shipItCache, { recursive: true, force: true });
  rmSync(state.updaterId, { force: true });
  copyIfPresent(join(resolvedBackupRoot, "updater-cache"), state.updaterCache);
  copyIfPresent(join(resolvedBackupRoot, "shipit-cache"), state.shipItCache);
  copyIfPresent(join(resolvedBackupRoot, "updater-id"), state.updaterId);
  // The release root is single-use and contains only the replaceable app and updater evidence.
  rmSync(state.stateRoot, { recursive: true, force: true });
  rmSync(resolvedBackupRoot, { recursive: true, force: true });
}

function deriveRestorePaths(stateRoot, backupRoot, appName, updaterCacheName, options) {
  const resolvedStateRoot = canonicalizePendingPath(stateRoot);
  const resolvedBackupRoot = canonicalizePendingPath(backupRoot);
  const home = resolve(options.home ?? homedir());
  const temporaryRoot = realpathSync(resolve(options.temporaryRoot ?? tmpdir()));
  const allowedParent = realpathSync(resolve(options.runnerTemp ?? process.env.RUNNER_TEMP ?? temporaryRoot));
  if (
    !["Markd.app", "Riffle.app"].includes(appName) ||
    !updaterCacheNames.has(updaterCacheName) ||
    !basename(resolvedStateRoot).startsWith("riffle-release-e2e-") ||
    !basename(resolvedBackupRoot).startsWith("riffle-updater-backup-") ||
    !isContainedBy(resolvedStateRoot, allowedParent) ||
    !isContainedBy(resolvedBackupRoot, allowedParent) ||
    realpathSync(dirname(resolvedStateRoot)) !== allowedParent ||
    realpathSync(dirname(resolvedBackupRoot)) !== allowedParent
  ) {
    throw new Error("Updater hygiene restore paths escaped the allowed temporary root.");
  }
  const appPath = join(resolvedStateRoot, appName);
  const cacheRoot = join(home, "Library", "Caches");
  return {
    appPath,
    stateRoot: resolvedStateRoot,
    backupRoot: resolvedBackupRoot,
    allowedParent,
    temporaryRoot,
    configPath: join(appPath, "Contents", "Resources", "app-update.yml"),
    updaterCacheName,
    updaterCache: join(cacheRoot, updaterCacheName),
    shipItCache: join(cacheRoot, shipItLabel),
    updaterId: join(resolvedStateRoot, "config", ".updaterId"),
    launchdLabel: shipItLabel,
    preferencesDomain: shipItLabel,
  };
}

function isContainedBy(candidate, parent) {
  return candidate === parent || candidate.startsWith(`${parent}${sep}`);
}

function canonicalizePendingPath(path) {
  const resolved = resolve(path);
  return join(realpathSync(dirname(resolved)), basename(resolved));
}

function assertBundleId(appPath, options) {
  const result = run("/usr/libexec/PlistBuddy", [
    "-c",
    "Print :CFBundleIdentifier",
    join(appPath, "Contents", "Info.plist"),
  ], options);
  if (result.stdout.trim() !== bundleId) {
    throw new Error(`Updater baseline bundle id must be ${bundleId}.`);
  }
}

function assertNoProductProcess(options) {
  const result = run("ps", ["-axo", "pid=,command="], options);
  const running = result.stdout.split("\n").filter((line) =>
    /\/(?:Markd|Riffle)\.app\/Contents\/MacOS\/(?:Markd|Riffle)(?:\s|$)/u.test(line),
  );
  if (running.length > 0) {
    throw new Error("A released app process is already running; updater hygiene refused to mutate shared state.");
  }
}

function launchdJobExists(scope, label, options) {
  return spawn("launchctl", ["print", `${scope}/${label}`], options).status === 0;
}

function bootoutLaunchdJob(label, options) {
  for (const scope of [`gui/${process.getuid()}`, "system"]) {
    if (launchdJobExists(scope, label, options)) run("launchctl", ["bootout", `${scope}/${label}`], options);
  }
  for (const scope of [`gui/${process.getuid()}`, "system"]) {
    if (launchdJobExists(scope, label, options)) {
      throw new Error(`Updater launchd job remained loaded after bootout: ${scope}/${label}`);
    }
  }
}

function preferencesExist(domain, options) {
  return spawn("defaults", ["-currentHost", "read", domain], options).status === 0;
}

function clearPreferences(domain, options) {
  const result = spawn("defaults", ["-currentHost", "delete", domain], options);
  if (preferencesExist(domain, options)) {
    throw new Error(
      `Updater preferences remained after delete (${result.stderr?.trim() || `exit ${result.status}`}): ${domain}`,
    );
  }
}

function spawn(command, args, options) {
  return (options.spawnSyncImpl ?? spawnSync)(command, args, { encoding: "utf8" });
}

function run(command, args, options) {
  const result = spawn(command, args, options);
  if (result.status !== 0) {
    throw new Error(`${command} failed: ${result.stderr?.trim() || `exit ${result.status}`}`);
  }
  return result;
}

function listShipItTemporaryEntries(root) {
  return readdirSync(root).filter(isShipItTemporaryName).sort();
}

function isShipItTemporaryName(name) {
  return /^app\.usemarkd\.ShipIt\.[A-Za-z0-9._-]+$/u.test(name) && basename(name) === name;
}

function removeNewShipItTemporaryEntries(root, before) {
  const retained = new Set(before);
  for (const name of listShipItTemporaryEntries(root)) {
    if (!retained.has(name)) rmSync(join(root, name), { recursive: true, force: true });
  }
}

function moveIfPresent(from, to) {
  if (!existsSync(from)) return;
  mkdirSync(dirname(to), { recursive: true });
  renameSync(from, to);
}

function copyIfPresent(from, to) {
  if (!existsSync(from)) return;
  mkdirSync(dirname(to), { recursive: true });
  cpSync(from, to, { recursive: true, errorOnExist: false, force: true });
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath && pathToFileURL(invokedPath).href === import.meta.url) {
  const [command, appPath, stateRoot, backupRoot] = process.argv.slice(2);
  if (command === "prepare" && appPath && stateRoot && backupRoot) {
    console.log(JSON.stringify(prepareUpdaterHygiene(appPath, stateRoot, backupRoot)));
  } else if (command === "restore" && appPath) {
    restoreUpdaterHygiene(appPath);
  } else {
    throw new Error(
      "Usage: updater-hygiene.mjs prepare <app> <state-root> <backup-root> | restore <backup-root>",
    );
  }
}
