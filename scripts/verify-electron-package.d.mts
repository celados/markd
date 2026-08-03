export type ElectronPackageInventory = {
  appPath: string;
  asarPath: string;
  fffLibrary: string;
  ffiAddon: string;
  updateConfig: string;
};

export function inspectElectronPackage(
  appPath: string,
  arch?: string,
): ElectronPackageInventory;
export function findPackagedApp(
  outputDir: string,
  arch?: string,
): string;
export function inspectUpdateManifest(
  outputDir: string,
): { manifestPath: string; artifacts: string[] };
