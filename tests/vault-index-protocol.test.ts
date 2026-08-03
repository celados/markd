import { describe, expect, test } from "vitest";
import {
  advanceVaultIndexCursor,
  type VaultIndexCursor,
} from "../electron/vault-index-protocol";

const initial: VaultIndexCursor = {
  engineEpoch: 4,
  indexEpoch: 2,
  sequence: 3,
  synchronized: true,
};

describe("Vault Index protocol", () => {
  test("accepts contiguous changes", () => {
    expect(advanceVaultIndexCursor(initial, {
      engineEpoch: 4,
      indexEpoch: 2,
      sequence: 4,
      replacement: false,
    })).toEqual({ decision: "accept", cursor: { ...initial, sequence: 4 } });
  });

  test("requires a replacement snapshot after a sequence gap", () => {
    const gap = advanceVaultIndexCursor(initial, {
      engineEpoch: 4,
      indexEpoch: 2,
      sequence: 6,
      replacement: false,
    });
    expect(gap).toEqual({
      decision: "resync",
      cursor: { ...initial, synchronized: false },
    });

    expect(advanceVaultIndexCursor(gap.cursor, {
      engineEpoch: 4,
      indexEpoch: 2,
      sequence: 7,
      replacement: false,
    })).toEqual({
      decision: "resync",
      cursor: { ...initial, synchronized: false },
    });

    expect(advanceVaultIndexCursor(gap.cursor, {
      engineEpoch: 4,
      indexEpoch: 3,
      sequence: 0,
      replacement: true,
    })).toEqual({
      decision: "accept",
      cursor: {
        engineEpoch: 4,
        indexEpoch: 3,
        sequence: 0,
        synchronized: true,
      },
    });
  });

  test("requires a full snapshot before accepting a replacement utility", () => {
    expect(advanceVaultIndexCursor(initial, {
      engineEpoch: 5,
      indexEpoch: 1,
      sequence: 1,
      replacement: false,
    })).toEqual({
      decision: "resync",
      cursor: { ...initial, synchronized: false },
    });
  });

  test("replacement snapshots recover gaps and reject stale generations", () => {
    const stale = advanceVaultIndexCursor(initial, {
      engineEpoch: 3,
      indexEpoch: 99,
      sequence: 0,
      replacement: true,
    });
    expect(stale).toEqual({ decision: "ignore", cursor: initial });

    expect(advanceVaultIndexCursor(stale.cursor, {
      engineEpoch: 5,
      indexEpoch: 1,
      sequence: 0,
      replacement: true,
    })).toEqual({
      decision: "accept",
      cursor: {
        engineEpoch: 5,
        indexEpoch: 1,
        sequence: 0,
        synchronized: true,
      },
    });
  });
});
