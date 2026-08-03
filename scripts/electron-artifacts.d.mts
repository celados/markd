export type ElectronArtifactNames = {
  dmg: string;
  zip: string;
  zipBlockmap: string;
  manifest: string;
};

export function electronArtifactNames(
  version: string,
  arch?: string,
): ElectronArtifactNames;
export function formatArtifactEnvironment(version: string, arch?: string): string;
