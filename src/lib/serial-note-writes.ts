export type NoteWriteResult = {
  desired: string;
  committed: string;
};

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
    this.#pending += 1;

    const result = this.#tail.then(async () => {
      const desired = rebaseAppendOnly(base, draft, this.#committed);
      const committed = await write(desired, this.#committed);
      this.#committed = committed;
      return { desired, committed };
    });
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
