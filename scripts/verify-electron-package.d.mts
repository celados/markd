export type ElectronPackageInventory = {
  appPath: string;
  asarPath: string;
  fffLibrary: string;
  ffiAddon: string;
  nativeFiles: string[];
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
  expectedVersion: string,
  arch?: string,
): {
  manifestPath: string;
  artifacts: string[];
  primaryArtifact: string;
  releaseArtifacts: string[];
};
export function inspectReleaseArtifacts(
  outputDir: string,
  expectedVersion: string,
  arch?: string,
): string[];
