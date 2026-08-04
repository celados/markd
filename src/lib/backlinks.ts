export const BACKLINKS_CHANGED = "riffle:backlinks-changed";
export const NOTES_REWRITTEN = "riffle:notes-rewritten";

export function notifyBacklinksChanged() {
  window.dispatchEvent(new Event(BACKLINKS_CHANGED));
}

export function notifyNotesRewritten() {
  window.dispatchEvent(new Event(NOTES_REWRITTEN));
  notifyBacklinksChanged();
}
