export type NoteWriteResult = {
  desired: string;
  committed: string;
};

export type NoteSourceMutation = (source: string) => string;

export class StaleNoteDraftError extends Error {
  constructor() {
    super("The Note changed while local saves were queued.");
    this.name = "StaleNoteDraftError";
  }
}

export function rebaseAppendOnly(
  base: string,
  draft: string,
  committed: string,
): string {
  if (committed === base) return draft;
  if (!committed.startsWith(base)) throw new StaleNoteDraftError();
  const appended = committed.slice(base.length);
  return draft.endsWith(appended) ? draft : `${draft}${appended}`;
}

export class SerialNoteWrites {
  #committed: string;
  #queuedBase: string;
  #tail: Promise<void> = Promise.resolve();
  #pending = 0;

  constructor(committed: string) {
    this.#committed = committed;
    this.#queuedBase = committed;
  }

  reset(committed: string): void {
    if (this.#pending > 0) return;
    this.#committed = committed;
    this.#queuedBase = committed;
  }

  save(
    draft: string,
    write: (desired: string, expected: string) => Promise<string>,
  ): Promise<NoteWriteResult> {
    const base = this.#queuedBase;
    this.#queuedBase = draft;
    return this.#enqueue(async () => {
      const desired = rebaseAppendOnly(base, draft, this.#committed);
      const committed = await write(desired, this.#committed);
      this.#committed = committed;
      return { desired, committed };
    });
  }

  mutateLatest(
    mutation: NoteSourceMutation,
    read: () => Promise<string>,
    write: (desired: string, expected: string) => Promise<string>,
  ): Promise<NoteWriteResult> {
    this.#queuedBase = mutation(this.#queuedBase);
    return this.#enqueue(async () => {
      let base = await read();
      this.#committed = base;
      let desired = mutation(base);
      let committed: string;
      try {
        committed = await write(desired, base);
      } catch (error) {
        if (!isStaleNoteWrite(error)) throw error;
        // A Property action owns metadata intent, so one fresh CAS retry can
        // preserve an independently changed body without weakening body conflicts.
        base = await read();
        this.#committed = base;
        desired = mutation(base);
        committed = await write(desired, base);
      }
      this.#committed = committed;
      return { desired, committed };
    });
  }

  #enqueue(operation: () => Promise<NoteWriteResult>): Promise<NoteWriteResult> {
    this.#pending += 1;
    const result = this.#tail.then(operation);
    this.#tail = result.then(
      () => undefined,
      () => undefined,
    );
    const settle = () => {
      this.#pending -= 1;
      if (this.#pending === 0) this.#queuedBase = this.#committed;
    };
    void result.then(settle, settle);
    return result;
  }
}

function isStaleNoteWrite(error: unknown): error is { kind: "STALE_NOTE_WRITE" } {
  return typeof error === "object" && error !== null && "kind" in error &&
    error.kind === "STALE_NOTE_WRITE";
}
