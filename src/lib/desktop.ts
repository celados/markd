import type {
  Bookmark,
  BookmarkChange,
  CloudAccountStatus,
  CollectionKind,
  CollectionsSnapshot,
  PinSnapshot,
  Todo,
  TodoChange,
  VaultSnapshot,
} from "./types";

export type DesktopErrorData = {
  kind: string;
  message: string;
  details?: unknown;
};

export type DesktopResult<T> = { ok: true; value: T } | { ok: false; error: DesktopErrorData };

export type EngineLifecycle =
  | { state: "starting"; epoch: number }
  | { state: "ready"; epoch: number }
  | { state: "unavailable"; epoch: number; error: DesktopErrorData };

export type DesktopUpdate = {
  id: string;
  currentVersion: string;
  version: string;
  body?: string;
  rawJson?: Record<string, unknown>;
};

export type MarkdDesktop = {
  app: {
    windowKind: "main" | "quick-capture";
    onNotesChanged: (listener: () => void) => () => void;
    onEngineLifecycle: (listener: (event: EngineLifecycle) => void) => () => void;
  };
  vault: {
    startup: () => Promise<DesktopResult<VaultSnapshot | null>>;
    choose: () => Promise<DesktopResult<VaultSnapshot | null>>;
    create: () => Promise<DesktopResult<VaultSnapshot | null>>;
    snapshot: () => Promise<DesktopResult<VaultSnapshot>>;
    createNote: (
      dir: string,
      title: string,
      content?: string,
    ) => Promise<DesktopResult<{ rel: string; snapshot: VaultSnapshot }>>;
    readNote: (rel: string) => Promise<DesktopResult<string>>;
    writeNote: (rel: string, content: string) => Promise<DesktopResult<null>>;
    moveToTrash: (rel: string) => Promise<DesktopResult<{ snapshot: VaultSnapshot }>>;
    resolveNotePath: (rel: string) => Promise<DesktopResult<string>>;
    pins: {
      list: () => Promise<DesktopResult<PinSnapshot>>;
      add: (rel: string) => Promise<DesktopResult<PinSnapshot>>;
      remove: (rel: string) => Promise<DesktopResult<PinSnapshot>>;
    };
  };
  collections: {
    snapshot: () => Promise<DesktopResult<CollectionsSnapshot>>;
    todos: {
      create: (
        text: string,
        tags?: string[],
      ) => Promise<DesktopResult<{ snapshot: CollectionsSnapshot; item: Todo }>>;
      change: (
        id: string,
        change: TodoChange,
      ) => Promise<DesktopResult<{ snapshot: CollectionsSnapshot; item: Todo }>>;
      remove: (id: string) => Promise<DesktopResult<CollectionsSnapshot>>;
      clearCompleted: () => Promise<DesktopResult<CollectionsSnapshot>>;
    };
    bookmarks: {
      create: (
        url: string,
        tags?: string[],
      ) => Promise<DesktopResult<{ snapshot: CollectionsSnapshot; item: Bookmark }>>;
      change: (
        id: string,
        change: BookmarkChange,
      ) => Promise<DesktopResult<{ snapshot: CollectionsSnapshot; item: Bookmark }>>;
      remove: (id: string) => Promise<DesktopResult<CollectionsSnapshot>>;
    };
    tags: {
      create: (
        collection: CollectionKind,
        name: string,
      ) => Promise<DesktopResult<CollectionsSnapshot>>;
      delete: (
        collection: CollectionKind,
        name: string,
      ) => Promise<DesktopResult<CollectionsSnapshot>>;
    };
  };
  cloud?: {
    accountStatus: () => Promise<DesktopResult<CloudAccountStatus>>;
    plansUrl: () => Promise<DesktopResult<string>>;
    billingPortalUrl: () => Promise<DesktopResult<string>>;
  };
  updates: {
    check: () => Promise<DesktopResult<DesktopUpdate | null>>;
    install: (id: string) => Promise<DesktopResult<null>>;
    relaunch: () => Promise<DesktopResult<null>>;
  };
};

export class DesktopError extends Error {
  kind: string;
  details?: unknown;

  constructor(data: DesktopErrorData) {
    super(data.message);
    this.name = "DesktopError";
    this.kind = data.kind;
    this.details = data.details;
  }
}

declare global {
  interface Window {
    markd?: MarkdDesktop;
  }
}

export function getWindowKind(): "main" | "quick-capture" {
  return window.markd?.app.windowKind ?? "main";
}

export async function onNotesChanged(listener: () => void): Promise<() => void> {
  if (window.markd) return window.markd.app.onNotesChanged(listener);
  const { listen } = await import("@tauri-apps/api/event");
  return listen("markd:notes-changed", listener);
}

export async function unwrapDesktopResult<T>(resultPromise: Promise<DesktopResult<T>>): Promise<T> {
  const result = await resultPromise;
  if (result.ok) return result.value;
  throw new DesktopError(result.error);
}
