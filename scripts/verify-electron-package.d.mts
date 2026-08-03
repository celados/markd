export type ElectronPackageInventory = {
  appPath: string;
  asarPath: string;
  fffLibrary: string;
  ffiAddon: string;
  updateConfig: string;
};

export function inspectElectronPackage(appPath: string): ElectronPackageInventory;
export function findPackagedApp(outputDir: string): string;
