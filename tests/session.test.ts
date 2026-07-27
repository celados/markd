import { beforeEach, describe, expect, test } from "bun:test";
import { restoreSession } from "../src/lib/session";
import { SIDEBAR_DEFAULT_WIDTH } from "../src/lib/sidebarResize";
import { useUi } from "../src/stores/ui";

const items = new Map<string, string>();
const storage: Storage = {
  get length() {
    return items.size;
  },
  clear() {
    items.clear();
  },
  getItem(key) {
    return items.get(key) ?? null;
  },
  key(index) {
    return [...items.keys()][index] ?? null;
  },
  removeItem(key) {
    items.delete(key);
  },
  setItem(key, value) {
    items.set(key, value);
  },
};

Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: storage,
});

describe("session restoration", () => {
  beforeEach(() => {
    storage.clear();
    useUi.getState().setSidebarWidth(360);
  });

  test("resets the width when the next vault has no saved session", () => {
    restoreSession("/vault-b");

    expect(useUi.getState().sidebarWidth).toBe(SIDEBAR_DEFAULT_WIDTH);
  });

  test("resets the width for sessions saved before width persistence", () => {
    storage.setItem(
      "markd:session:/legacy-vault",
      JSON.stringify({
        tabs: [],
        view: null,
        todoFilter: null,
        bookmarkFilter: null,
      }),
    );

    restoreSession("/legacy-vault");

    expect(useUi.getState().sidebarWidth).toBe(SIDEBAR_DEFAULT_WIDTH);
  });

  test("restores a vault's saved width", () => {
    storage.setItem(
      "markd:session:/saved-vault",
      JSON.stringify({
        tabs: [],
        view: null,
        todoFilter: null,
        bookmarkFilter: null,
        sidebarWidth: 320,
      }),
    );

    restoreSession("/saved-vault");

    expect(useUi.getState().sidebarWidth).toBe(320);
  });
});
