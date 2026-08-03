export const VAULT_NOTE_CHANGED = "markd:vault-note-changed";

export type VaultNoteChangedDetail = {
  rel: string;
  kind: "modified" | "removed";
};

export function notifyVaultNoteChanged(detail: VaultNoteChangedDetail): boolean {
  return window.dispatchEvent(new CustomEvent<VaultNoteChangedDetail>(
    VAULT_NOTE_CHANGED,
    { detail, cancelable: detail.kind === "removed" },
  ));
}
