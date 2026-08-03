import { invoke } from "@tauri-apps/api/core";
import type {
  BacklinkMention,
  CloudAccountStatus,
  CloudAccount,
  Bookmark,
  CollectionsSnapshot,
  PublishedNoteStatus,
  PublishPageDraft,
  PublishedShare,
  OtpChallenge,
  PinSnapshot,
  SearchHit,
  Theme,
  Todo,
  TreeNode,
  VaultSnapshot,
} from "./types";
import { unwrapDesktopResult } from "./desktop";

interface ErrorPayload {
  kind: string;
  message: string;
  details?: unknown;
}

export class IpcError extends Error {
  kind: string;
  details?: unknown;

  constructor(payload: ErrorPayload) {
    super(payload.message);
    this.kind = payload.kind;
    this.details = payload.details;
  }
}

function mainWindowCapabilityError(): IpcError {
  return new IpcError({
    kind: "INVALID_WINDOW",
    message: "Export is only available from the main window.",
  });
}

async function call<T>(command: string, args?: Record<string, unknown>) {
  try {
    return await invoke<T>(command, args);
  } catch (raw) {
    if (raw && typeof raw === "object" && "message" in raw) {
      throw new IpcError(raw as ErrorPayload);
    }
    throw new IpcError({ kind: "other", message: String(raw) });
  }
}

export const ipc = {
  startup: () =>
    window.markd
      ? unwrapDesktopResult(window.markd.vault.startup())
      : call<VaultSnapshot | null>("startup"),
  chooseVault: () =>
    window.markd
      ? unwrapDesktopResult(window.markd.vault.choose())
      : call<VaultSnapshot | null>("choose_vault"),
  createVault: () =>
    window.markd
      ? unwrapDesktopResult(window.markd.vault.create())
      : call<VaultSnapshot | null>("create_vault"),
  loadTree: async () =>
    window.markd
      ? (await unwrapDesktopResult(window.markd.vault.snapshot())).tree
      : call<TreeNode[]>("load_tree"),

  readNote: (rel: string) =>
    window.markd
      ? unwrapDesktopResult(window.markd.vault.readNote(rel))
      : call<string>("read_note", { rel }),
  writeNote: (rel: string, content: string, expectedContent: string) =>
    window.markd
      ? unwrapDesktopResult(
          window.markd.vault.writeNote(rel, content, expectedContent),
        )
      : call<void>("write_note", { rel, content }).then(() => content),
  createNote: (dir: string, title: string) =>
    window.markd
      ? unwrapDesktopResult(window.markd.vault.createNote(dir, title)).then(({ rel }) => rel)
      : call<string>("create_note", { dir, title }),
  createNoteWithContent: (dir: string, title: string, content: string) =>
    window.markd
      ? unwrapDesktopResult(window.markd.vault.createNote(dir, title, content)).then(
          ({ rel }) => rel,
        )
      : call<string>("create_note_with_content", { dir, title, content }),
  openDailyNote: (date: string) => call<string>("open_daily_note", { date }),
  showQuickCapture: () =>
    window.markd
      ? unwrapDesktopResult(window.markd.capture.open())
      : call<void>("show_quick_capture"),
  closeQuickCapture: () =>
    window.markd
      ? unwrapDesktopResult(window.markd.capture.close())
      : call<void>("close_quick_capture"),
  createFolder: (dir: string, name: string) => call<string>("create_folder", { dir, name }),
  renameEntry: (rel: string, name: string) => call<string>("rename_entry", { rel, name }),
  moveEntry: (rel: string, dir: string) => call<string>("move_entry", { rel, dir }),
  deleteEntry: (rel: string) =>
    window.markd
      ? unwrapDesktopResult(window.markd.vault.moveToTrash(rel)).then(() => undefined)
      : call<void>("delete_entry", { rel }),
  searchNotes: (query: string, limit?: number) =>
    window.markd
      ? unwrapDesktopResult(window.markd.vault.search(query, limit))
      : call<SearchHit[]>("search_notes", { query, limit }),
  recordSearchAccess: (rel: string) =>
    window.markd
      ? unwrapDesktopResult(window.markd.vault.recordSearchAccess(rel))
      : call<void>("record_search_access", { rel }).then(() => null),
  backlinksFor: (rel: string) =>
    window.markd
      ? unwrapDesktopResult(window.markd.vault.backlinks(rel))
      : call<BacklinkMention[]>("backlinks_for", { rel }),
  cloudAccountStatus: () =>
    window.markd?.cloud
      ? unwrapDesktopResult(window.markd.cloud.accountStatus())
      : call<CloudAccountStatus>("cloud_account_status"),
  cloudRequestOtp: (email: string) =>
    window.markd?.cloud
      ? unwrapDesktopResult(window.markd.cloud.requestOtp(email))
      : call<OtpChallenge>("cloud_request_otp", { email }),
  cloudVerifyOtp: (challengeId: string, code: string) =>
    window.markd?.cloud
      ? unwrapDesktopResult(window.markd.cloud.verifyOtp(challengeId, code))
      : call<CloudAccount>("cloud_verify_otp", { challengeId, code }),
  cloudSignOut: () =>
    window.markd?.cloud
      ? unwrapDesktopResult(window.markd.cloud.signOut()).then(() => undefined)
      : call<void>("cloud_sign_out"),
  cloudPlansUrl: () =>
    window.markd?.cloud
      ? unwrapDesktopResult(window.markd.cloud.plansUrl())
      : call<string>("cloud_plans_url"),
  cloudBillingPortalUrl: () =>
    window.markd?.cloud
      ? unwrapDesktopResult(window.markd.cloud.billingPortalUrl())
      : call<string>("cloud_billing_portal_url"),
  publishedNoteStatus: (rel: string, title: string, content: string, pages: PublishPageDraft[]) =>
    window.markd?.cloud
      ? unwrapDesktopResult(window.markd.cloud.publishedNoteStatus(rel, title, content, pages))
      : call<PublishedNoteStatus>("published_note_status", { rel, title, content, pages }),
  isNotePublished: (rel: string) =>
    window.markd?.cloud
      ? unwrapDesktopResult(window.markd.cloud.isNotePublished(rel))
      : call<boolean>("is_note_published", { rel }),
  publishNote: (rel: string, title: string, content: string, pages: PublishPageDraft[]) =>
    window.markd?.cloud
      ? unwrapDesktopResult(window.markd.cloud.publishNote(rel, title, content, pages))
      : call<PublishedShare>("publish_note", { rel, title, content, pages }),
  updatePublishedNote: (rel: string, title: string, content: string, pages: PublishPageDraft[]) =>
    window.markd?.cloud
      ? unwrapDesktopResult(window.markd.cloud.updatePublishedNote(rel, title, content, pages))
      : call<PublishedShare>("update_published_note", { rel, title, content, pages }),
  revokePublishedNote: (rel: string) =>
    window.markd?.cloud
      ? unwrapDesktopResult(window.markd.cloud.revokePublishedNote(rel)).then(() => undefined)
      : call<void>("revoke_published_note", { rel }),
  pinsList: () =>
    window.markd
      ? unwrapDesktopResult(window.markd.vault.pins.list())
      : call<string[]>("pins_list").then((pins): PinSnapshot => ({ pins, stale: [] })),
  pinNote: (rel: string) =>
    window.markd
      ? unwrapDesktopResult(window.markd.vault.pins.add(rel))
      : call<string[]>("pin_note", { rel }).then((pins): PinSnapshot => ({ pins, stale: [] })),
  unpinNote: (rel: string) =>
    window.markd
      ? unwrapDesktopResult(window.markd.vault.pins.remove(rel))
      : call<string[]>("unpin_note", { rel }).then((pins): PinSnapshot => ({ pins, stale: [] })),
  notePath: (rel: string) =>
    window.markd
      ? unwrapDesktopResult(window.markd.vault.resolveNotePath(rel))
      : call<string>("note_path", { rel }),

  collectionsSnapshot: async (): Promise<CollectionsSnapshot> => {
    if (window.markd) {
      return unwrapDesktopResult(window.markd.collections.snapshot());
    }
    const [todos, todoTags, bookmarks, bookmarkTags] = await Promise.all([
      call<Todo[]>("todos_list"),
      call<string[]>("todo_tags_list"),
      call<Bookmark[]>("bookmarks_list"),
      call<string[]>("bookmark_tags_list"),
    ]);
    return { todos, todoTags, bookmarks, bookmarkTags };
  },

  todoAdd: (text: string) =>
    window.markd
      ? unwrapDesktopResult(window.markd.collections.todos.create(text)).then((value) => value.item)
      : call<Todo>("todo_add", { text }),
  todoToggle: (id: string) =>
    window.markd
      ? unwrapDesktopResult(window.markd.collections.todos.change(id, { type: "toggle" })).then(
          (value) => value.item,
        )
      : call<Todo>("todo_toggle", { id }),
  todoUpdate: (id: string, text: string) =>
    window.markd
      ? unwrapDesktopResult(window.markd.collections.todos.change(id, { type: "text", text })).then(
          (value) => value.item,
        )
      : call<Todo>("todo_update", { id, text }),
  todoSetTags: (id: string, tags: string[]) =>
    window.markd
      ? unwrapDesktopResult(window.markd.collections.todos.change(id, { type: "tags", tags })).then(
          (value) => value.item,
        )
      : call<Todo>("todo_set_tags", { id, tags }),
  todoTagCreate: (name: string) =>
    window.markd
      ? unwrapDesktopResult(window.markd.collections.tags.create("todos", name)).then(
          (value) => value.todoTags,
        )
      : call<string[]>("todo_tag_create", { name }),
  todoTagDelete: (name: string) =>
    window.markd
      ? unwrapDesktopResult(window.markd.collections.tags.delete("todos", name)).then(
          (value) => value.todoTags,
        )
      : call<string[]>("todo_tag_delete", { name }),
  todoDelete: (id: string) =>
    window.markd
      ? unwrapDesktopResult(window.markd.collections.todos.remove(id)).then(() => undefined)
      : call<void>("todo_delete", { id }),
  todosClearCompleted: () =>
    window.markd
      ? unwrapDesktopResult(window.markd.collections.todos.clearCompleted()).then(
          (value) => value.todos,
        )
      : call<Todo[]>("todos_clear_completed"),

  bookmarkAdd: (url: string) =>
    window.markd
      ? unwrapDesktopResult(window.markd.collections.bookmarks.create(url)).then(
          (value) => value.item,
        )
      : call<Bookmark>("bookmark_add", { url }),
  bookmarkUpdateTitle: (id: string, title: string) =>
    window.markd
      ? unwrapDesktopResult(
          window.markd.collections.bookmarks.change(id, { type: "title", title }),
        ).then((value) => value.item)
      : call<Bookmark>("bookmark_update_title", { id, title }),
  bookmarkSetTags: (id: string, tags: string[]) =>
    window.markd
      ? unwrapDesktopResult(
          window.markd.collections.bookmarks.change(id, { type: "tags", tags }),
        ).then((value) => value.item)
      : call<Bookmark>("bookmark_set_tags", { id, tags }),
  bookmarkTagCreate: (name: string) =>
    window.markd
      ? unwrapDesktopResult(window.markd.collections.tags.create("bookmarks", name)).then(
          (value) => value.bookmarkTags,
        )
      : call<string[]>("bookmark_tag_create", { name }),
  bookmarkTagDelete: (name: string) =>
    window.markd
      ? unwrapDesktopResult(window.markd.collections.tags.delete("bookmarks", name)).then(
          (value) => value.bookmarkTags,
        )
      : call<string[]>("bookmark_tag_delete", { name }),
  bookmarkDelete: (id: string) =>
    window.markd
      ? unwrapDesktopResult(window.markd.collections.bookmarks.remove(id)).then(() => undefined)
      : call<void>("bookmark_delete", { id }),
  bookmarkFetchMeta: (id: string) => call<Bookmark>("bookmark_fetch_meta", { id }),
  exportBookmarks: () => {
    if (!window.markd) return call<string | null>("export_bookmarks");
    const exportBookmarks = window.markd.collections.bookmarks.export;
    if (!exportBookmarks) return Promise.reject(mainWindowCapabilityError());
    return unwrapDesktopResult(exportBookmarks());
  },
  exportNote: (rel: string, content: string) => {
    if (!window.markd) return call<string | null>("export_note", { rel, content });
    const exportNote = window.markd.vault.exportNote;
    if (!exportNote) return Promise.reject(mainWindowCapabilityError());
    return unwrapDesktopResult(exportNote(rel, content));
  },

  saveImageAsset: (data: string, extension: string) =>
    window.markd
      ? unwrapDesktopResult(window.markd.vault.assets.save(data, extension))
      : call<string>("save_image_asset", { data, extension }),
  setTheme: (theme: Theme) => call<void>("set_theme", { theme }),
  getTheme: () => call<Theme>("get_theme"),
};
