export function verifyDraftRelease(options: {
  expectedVersion: string;
  localDir: string;
  readbackDir: string;
  metadataPath: string;
}): Promise<{
  version: string;
  assets: Record<string, { size: number; sha256: string; sha512: string }>;
}>;
