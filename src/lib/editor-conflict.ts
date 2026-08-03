export type ExternalNoteChangeInput = {
  disk: string;
  lastSaved: string;
  dirty: boolean;
};

export type ExternalNoteChangeDecision =
  | "unchanged"
  | "reload"
  | "keep-local";

/**
 * Local edits own a conflict until their write settles. Clean editors follow
 * disk because the Vault remains the durable source of truth.
 */
export function decideExternalNoteChange(
  input: ExternalNoteChangeInput,
): ExternalNoteChangeDecision {
  const { disk, lastSaved, dirty } = input;
  if (disk === lastSaved) return "unchanged";
  return dirty ? "keep-local" : "reload";
}
