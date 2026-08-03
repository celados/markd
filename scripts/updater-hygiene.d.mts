export type UpdaterHygienePaths = {
  appPath: string;
  stateRoot: string;
  backupRoot: string;
  allowedParent: string;
  temporaryRoot: string;
  configPath: string;
  updaterCache: string;
  shipItCache: string;
  updaterId: string;
  launchdLabel: string;
  preferencesDomain: string;
};

export type UpdaterHygieneOptions = {
  home?: string;
  runnerTemp?: string;
  temporaryRoot?: string;
  spawnSyncImpl?: (
    command: string,
    args: string[],
    options: { encoding: "utf8" },
  ) => { status: number | null; stdout?: string; stderr?: string };
};

export function resolveUpdaterHygienePaths(
  appPath: string,
  stateRoot: string,
  backupRoot: string,
  options?: UpdaterHygieneOptions,
): UpdaterHygienePaths;
export function prepareUpdaterHygiene(
  appPath: string,
  stateRoot: string,
  backupRoot: string,
  options?: UpdaterHygieneOptions,
): UpdaterHygienePaths;
export function restoreUpdaterHygiene(
  backupRoot: string,
  options?: UpdaterHygieneOptions,
): void;
