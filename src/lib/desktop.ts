import type {
  Bookmark,
  BookmarkChange,
  CloudAccount,
  CloudAccountStatus,
  CollectionKind,
  CollectionsSnapshot,
  PinSnapshot,
  OtpChallenge,
  PublishedNoteStatus,
  PublishedShare,
  PublishPageDraft,
  BacklinkMention,
  SearchHit,
  Todo,
  TodoChange,
  Theme,
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

export type VaultIndexEntry = {
  rel: string;
  kind: "note" | "folder";
  modifiedMs: number;
};

export type VaultChange =
  | { kind: "created" | "modified"; entry: VaultIndexEntry }
  | { kind: "removed"; rel: string };

export type VaultIndexEvent =
  | {
      kind: "replacement";
      indexEpoch: number;
      sequence: 0;
      snapshot: VaultSnapshot;
    }
  | {
      kind: "changes";
      indexEpoch: number;
      sequence: number;
      changes: VaultChange[];
    };

export type DesktopUpdate = {
  id: string;
  currentVersion: string;
  version: string;
  body?: string;
  rawJson?: Record<string, unknown>;
};

export type RiffleDesktop = {
  app: {
    windowKind: "main" | "quick-capture";
    onEngineLifecycle: (listener: (event: EngineLifecycle) => void) => () => void;
    openWebUrl: (url: string) => Promise<DesktopResult<null>>;
    revealVaultEntry: (rel: string) => Promise<DesktopResult<null>>;
  };
  capture: {
    open: () => Promise<DesktopResult<null>>;
    close: () => Promise<DesktopResult<null>>;
    create: (
      title: string,
      content: string,
    ) => Promise<DesktopResult<{ rel: string; snapshot: VaultSnapshot }>>;
    append: (
      rel: string,
      content: string,
    ) => Promise<DesktopResult<{ rel: string; snapshot: VaultSnapshot }>>;
    onOpen: (listener: () => void) => () => void;
  };
  vault: {
    startup: () => Promise<DesktopResult<VaultSnapshot | null>>;
    choose: () => Promise<DesktopResult<VaultSnapshot | null>>;
    create: () => Promise<DesktopResult<VaultSnapshot | null>>;
    snapshot: () => Promise<DesktopResult<VaultSnapshot>>;
    onIndexEvent: (listener: (event: VaultIndexEvent) => void) => () => void;
    createNote: (
      dir: string,
      title: string,
      content?: string,
    ) => Promise<DesktopResult<{ rel: string; snapshot: VaultSnapshot }>>;
    openDailyNote: (date: string) => Promise<DesktopResult<{ rel: string; snapshot: VaultSnapshot }>>;
    createFolder: (dir: string, name: string) => Promise<DesktopResult<{ rel: string; snapshot: VaultSnapshot }>>;
    renameEntry: (rel: string, name: string) => Promise<DesktopResult<{ rel: string; snapshot: VaultSnapshot }>>;
    moveEntry: (rel: string, dir: string) => Promise<DesktopResult<{ rel: string; snapshot: VaultSnapshot }>>;
    readNote: (rel: string) => Promise<DesktopResult<string>>;
    writeNote: (
      rel: string,
      content: string,
      expectedContent: string,
    ) => Promise<DesktopResult<string>>;
    moveToTrash: (rel: string) => Promise<DesktopResult<{ snapshot: VaultSnapshot }>>;
    resolveNotePath: (rel: string) => Promise<DesktopResult<string>>;
    getTheme: () => Promise<DesktopResult<Theme>>;
    setTheme: (theme: Theme) => Promise<DesktopResult<null>>;
    search: (query: string, limit?: number) => Promise<DesktopResult<SearchHit[]>>;
    recordSearchAccess: (rel: string) => Promise<DesktopResult<null>>;
    backlinks: (rel: string) => Promise<DesktopResult<BacklinkMention[]>>;
    exportNote?: (rel: string, content: string) => Promise<DesktopResult<string | null>>;
    assets: {
      save: (data: string, extension: string) => Promise<DesktopResult<string>>;
      url: (rel: string) => string | null;
    };
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
      fetchMetadata: (id: string) => Promise<DesktopResult<{ snapshot: CollectionsSnapshot; item: Bookmark }>>;
      change: (
        id: string,
        change: BookmarkChange,
      ) => Promise<DesktopResult<{ snapshot: CollectionsSnapshot; item: Bookmark }>>;
      remove: (id: string) => Promise<DesktopResult<CollectionsSnapshot>>;
      export?: () => Promise<DesktopResult<string | null>>;
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
    requestOtp: (email: string) => Promise<DesktopResult<OtpChallenge>>;
    verifyOtp: (challengeId: string, code: string) => Promise<DesktopResult<CloudAccount>>;
    signOut: () => Promise<DesktopResult<null>>;
    plansUrl: () => Promise<DesktopResult<string>>;
    billingPortalUrl: () => Promise<DesktopResult<string>>;
    publishedNoteStatus: (
      rel: string,
      title: string,
      content: string,
      pages: PublishPageDraft[],
    ) => Promise<DesktopResult<PublishedNoteStatus>>;
    isNotePublished: (rel: string) => Promise<DesktopResult<boolean>>;
    publishNote: (
      rel: string,
      title: string,
      content: string,
      pages: PublishPageDraft[],
    ) => Promise<DesktopResult<PublishedShare>>;
    updatePublishedNote: (
      rel: string,
      title: string,
      content: string,
      pages: PublishPageDraft[],
    ) => Promise<DesktopResult<PublishedShare>>;
    revokePublishedNote: (rel: string) => Promise<DesktopResult<null>>;
    openExternal: (url: string) => Promise<DesktopResult<null>>;
  };
  updates?: {
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

export function onQuickCaptureOpen(listener: () => void): () => void {
  return window.riffle?.capture.onOpen(listener) ?? (() => {});
}

declare global {
  interface Window {
    riffle?: RiffleDesktop;
  }
}

export function getWindowKind(): "main" | "quick-capture" {
  return window.riffle?.app.windowKind ?? "main";
}

export function openWebUrl(url: string): Promise<void> {
  const operation = window.riffle?.app.openWebUrl(url);
  if (!operation) {
    return Promise.reject(new DesktopError({
      kind: "DESKTOP_UNAVAILABLE",
      message: "Riffle Desktop cannot open this URL.",
    }));
  }
  return unwrapDesktopResult(operation).then(() => undefined);
}

export function revealVaultEntry(rel: string): Promise<void> {
  const operation = window.riffle?.app.revealVaultEntry(rel);
  if (!operation) {
    return Promise.reject(new DesktopError({
      kind: "DESKTOP_UNAVAILABLE",
      message: "Riffle Desktop cannot reveal this Vault entry.",
    }));
  }
  return unwrapDesktopResult(operation).then(() => undefined);
}

export async function unwrapDesktopResult<T>(resultPromise: Promise<DesktopResult<T>>): Promise<T> {
  const result = await resultPromise;
  if (result.ok) return result.value;
  throw new DesktopError(result.error);
}
