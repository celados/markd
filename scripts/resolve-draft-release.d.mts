export interface DraftReleaseIdentity {
  id: number;
  tag_name: string;
  draft: true;
  prerelease: false;
  upload_url: string;
  [key: string]: unknown;
}

export interface ValidatedDraftRelease {
  releaseId: number;
  uploadUrl: string;
  release: DraftReleaseIdentity;
}

export function validateDraftRelease(
  release: Record<string, unknown>,
  expectedRepository: string,
  expectedTag: string,
): ValidatedDraftRelease;

export function resolveDraftRelease(
  pages: readonly (readonly Record<string, unknown>[])[],
  expectedRepository: string,
  expectedTag: string,
): DraftReleaseIdentity | null;
