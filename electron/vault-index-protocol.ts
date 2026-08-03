export type VaultIndexCursor = {
  engineEpoch: number;
  indexEpoch: number;
  sequence: number;
  synchronized: boolean;
};

export type VaultIndexPosition = {
  engineEpoch: number;
  indexEpoch: number;
  sequence: number;
  replacement: boolean;
};

export type VaultIndexDecision = {
  decision: "accept" | "ignore" | "resync";
  cursor: VaultIndexCursor;
};

export function advanceVaultIndexCursor(
  current: VaultIndexCursor | null,
  next: VaultIndexPosition,
): VaultIndexDecision {
  if (current && next.engineEpoch < current.engineEpoch) {
    return { decision: "ignore", cursor: current };
  }

  if (next.replacement) {
    const stale = current &&
      next.engineEpoch === current.engineEpoch &&
      (next.indexEpoch < current.indexEpoch ||
        (next.indexEpoch === current.indexEpoch && current.synchronized));
    if (stale) return { decision: "ignore", cursor: current };
    return {
      decision: "accept",
      cursor: {
        engineEpoch: next.engineEpoch,
        indexEpoch: next.indexEpoch,
        sequence: next.sequence,
        synchronized: true,
      },
    };
  }

  const contiguous = current?.synchronized === true &&
    next.engineEpoch === current.engineEpoch &&
    next.indexEpoch === current.indexEpoch &&
    next.sequence === current.sequence + 1;
  if (contiguous) {
    return { decision: "accept", cursor: { ...current, sequence: next.sequence } };
  }

  return {
    decision: "resync",
    cursor: current
      ? { ...current, synchronized: false }
      : {
          engineEpoch: next.engineEpoch,
          indexEpoch: next.indexEpoch,
          sequence: next.sequence,
          synchronized: false,
        },
  };
}
