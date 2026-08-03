type NoteWriteFlush = () => Promise<void>;

const flushers = new Map<symbol, NoteWriteFlush>();

export function registerNoteWriteFlush(flush: NoteWriteFlush): () => void {
  const token = Symbol("note-write-flush");
  flushers.set(token, flush);
  return () => flushers.delete(token);
}

export async function flushNoteWrites(): Promise<void> {
  const results = await Promise.allSettled(
    [...flushers.values()].map(async (flush) => flush()),
  );
  const failure = results.find(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  if (failure) throw failure.reason;
}
