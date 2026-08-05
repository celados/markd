import {
  DesktopError,
  type RiffleDesktop,
  unwrapDesktopResult,
} from "./desktop";
import type { PublishPageDraft, Theme } from "./types";

function desktop(): RiffleDesktop {
  if (window.riffle) return window.riffle;
  throw new DesktopError({
    kind: "DESKTOP_UNAVAILABLE",
    message: "Riffle Desktop is unavailable in this renderer.",
  });
}

function mainWindowCapabilityError(): DesktopError {
  return new DesktopError({
    kind: "INVALID_WINDOW",
    message: "This operation is only available from the main window.",
  });
}

function mainWindowCapability<T>(capability: T | undefined): T {
  if (capability) return capability;
  throw mainWindowCapabilityError();
}

function cloud() {
  return mainWindowCapability(desktop().cloud);
}

function updates() {
  return mainWindowCapability(desktop().updates);
}

export const vaultDesktop = {
  startup: () => unwrapDesktopResult(desktop().vault.startup()),
  choose: () => unwrapDesktopResult(desktop().vault.choose()),
  create: () => unwrapDesktopResult(desktop().vault.create()),
  snapshot: () => unwrapDesktopResult(desktop().vault.snapshot()),
  notes: {
    read: (rel: string) => unwrapDesktopResult(desktop().vault.readNote(rel)),
    write: (rel: string, content: string, expectedContent: string) =>
      unwrapDesktopResult(desktop().vault.writeNote(rel, content, expectedContent)),
    create: (dir: string, title: string, content = "") =>
      unwrapDesktopResult(desktop().vault.createNote(dir, title, content)),
    openDaily: (date: string) =>
      unwrapDesktopResult(desktop().vault.openDailyNote(date)),
    resolvePath: (rel: string) =>
      unwrapDesktopResult(desktop().vault.resolveNotePath(rel)),
    export: (rel: string, content: string) => {
      const operation = desktop().vault.exportNote;
      if (!operation) return Promise.reject(mainWindowCapabilityError());
      return unwrapDesktopResult(operation(rel, content));
    },
  },
  entries: {
    createFolder: (dir: string, name: string) =>
      unwrapDesktopResult(desktop().vault.createFolder(dir, name)),
    rename: (rel: string, name: string) =>
      unwrapDesktopResult(desktop().vault.renameEntry(rel, name)),
    move: (rel: string, dir: string) =>
      unwrapDesktopResult(desktop().vault.moveEntry(rel, dir)),
    moveToTrash: (rel: string) =>
      unwrapDesktopResult(desktop().vault.moveToTrash(rel)),
  },
  search: {
    query: (query: string, limit?: number) =>
      unwrapDesktopResult(desktop().vault.search(query, limit)),
    recordAccess: (rel: string) =>
      unwrapDesktopResult(desktop().vault.recordSearchAccess(rel)),
    backlinks: (rel: string) =>
      unwrapDesktopResult(desktop().vault.backlinks(rel)),
  },
  pins: {
    list: () => unwrapDesktopResult(desktop().vault.pins.list()),
    add: (rel: string) => unwrapDesktopResult(desktop().vault.pins.add(rel)),
    remove: (rel: string) => unwrapDesktopResult(desktop().vault.pins.remove(rel)),
  },
  assets: {
    save: (data: string, extension: string) =>
      unwrapDesktopResult(desktop().vault.assets.save(data, extension)),
    url: (rel: string) => desktop().vault.assets.url(rel),
  },
  theme: {
    get: () => unwrapDesktopResult(desktop().vault.getTheme()),
    set: (theme: Theme) => unwrapDesktopResult(desktop().vault.setTheme(theme)),
  },
};

export const collectionsDesktop = {
  snapshot: () => unwrapDesktopResult(desktop().collections.snapshot()),
  todos: {
    create: (text: string, tags: string[] = []) =>
      unwrapDesktopResult(desktop().collections.todos.create(text, tags)),
    change: (id: string, change: Parameters<RiffleDesktop["collections"]["todos"]["change"]>[1]) =>
      unwrapDesktopResult(desktop().collections.todos.change(id, change)),
    remove: (id: string) => unwrapDesktopResult(desktop().collections.todos.remove(id)),
    clearCompleted: () => unwrapDesktopResult(desktop().collections.todos.clearCompleted()),
  },
  bookmarks: {
    create: (url: string, tags: string[] = []) =>
      unwrapDesktopResult(desktop().collections.bookmarks.create(url, tags)),
    change: (id: string, change: Parameters<RiffleDesktop["collections"]["bookmarks"]["change"]>[1]) =>
      unwrapDesktopResult(desktop().collections.bookmarks.change(id, change)),
    fetchMetadata: (id: string) =>
      unwrapDesktopResult(desktop().collections.bookmarks.fetchMetadata(id)),
    remove: (id: string) => unwrapDesktopResult(desktop().collections.bookmarks.remove(id)),
    export: () => {
      const operation = desktop().collections.bookmarks.export;
      if (!operation) return Promise.reject(mainWindowCapabilityError());
      return unwrapDesktopResult(operation());
    },
  },
  tags: {
    create: (collection: "todos" | "bookmarks", name: string) =>
      unwrapDesktopResult(desktop().collections.tags.create(collection, name)),
    remove: (collection: "todos" | "bookmarks", name: string) =>
      unwrapDesktopResult(desktop().collections.tags.delete(collection, name)),
  },
};

export const cloudDesktop = {
  accountStatus: () => unwrapDesktopResult(cloud().accountStatus()),
  requestOtp: (email: string) => unwrapDesktopResult(cloud().requestOtp(email)),
  verifyOtp: (challengeId: string, code: string) =>
    unwrapDesktopResult(cloud().verifyOtp(challengeId, code)),
  signOut: () => unwrapDesktopResult(cloud().signOut()),
  plansUrl: () => unwrapDesktopResult(cloud().plansUrl()),
  billingPortalUrl: () => unwrapDesktopResult(cloud().billingPortalUrl()),
  status: (rel: string, title: string, content: string, pages: PublishPageDraft[]) =>
    unwrapDesktopResult(cloud().publishedNoteStatus(rel, title, content, pages)),
  isPublished: (rel: string) =>
    unwrapDesktopResult(cloud().isNotePublished(rel)),
  publish: (rel: string, title: string, content: string, pages: PublishPageDraft[]) =>
    unwrapDesktopResult(cloud().publishNote(rel, title, content, pages)),
  update: (rel: string, title: string, content: string, pages: PublishPageDraft[]) =>
    unwrapDesktopResult(cloud().updatePublishedNote(rel, title, content, pages)),
  revoke: (rel: string) => unwrapDesktopResult(cloud().revokePublishedNote(rel)),
  openExternal: (url: string) => unwrapDesktopResult(cloud().openExternal(url)),
};

export const captureDesktop = {
  open: () => unwrapDesktopResult(desktop().capture.open()),
  close: () => unwrapDesktopResult(desktop().capture.close()),
  create: (title: string, content: string) =>
    unwrapDesktopResult(desktop().capture.create(title, content)),
  append: (rel: string, content: string) =>
    unwrapDesktopResult(desktop().capture.append(rel, content)),
};

export const updatesDesktop = {
  check: () => unwrapDesktopResult(updates().check()),
  install: (id: string) => unwrapDesktopResult(updates().install(id)),
  relaunch: () => unwrapDesktopResult(updates().relaunch()),
};
