export type RemoteReleaseEvidence = {
  version: string;
  baseUrl: string;
  latestTag: string;
  primaryArtifact: string;
  assets: Record<string, { size: number; sha256: string; sha512: string }>;
};

export function verifyRemoteRelease(options: {
  outputDir: string;
  expectedVersion: string;
  arch?: string;
  baseUrl?: string;
  apiUrl?: string;
  latestApiUrl?: string;
  fetchImpl?: typeof fetch;
}): Promise<RemoteReleaseEvidence>;
