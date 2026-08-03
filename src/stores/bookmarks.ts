import { create } from "@octanejs/zustand";
import { toast } from "@octanejs/sonner";
import { collectionsDesktop } from "@/lib/desktop-services";
import type { Bookmark } from "@/lib/types";

interface BookmarksState {
  bookmarks: Bookmark[];
  /** the user's tag registry, in creation order */
  tagRegistry: string[];
  loaded: boolean;
  /** ids with a metadata fetch in flight */
  fetching: Set<string>;
  /** active tag filter for the bookmarks view (null = All) */
  tagFilter: string | null;
  setTagFilter: (tag: string | null) => void;
  load: () => Promise<void>;
  add: (url: string, tags?: string[]) => Promise<void>;
  fetchMeta: (id: string) => Promise<void>;
  updateTitle: (id: string, title: string) => Promise<void>;
  setTags: (id: string, tags: string[]) => Promise<void>;
  createTag: (name: string) => Promise<void>;
  deleteTag: (name: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  exportAll: () => Promise<void>;
}

const oops = (err: unknown) => toast.error(err instanceof Error ? err.message : String(err));

export const useBookmarks = create<BookmarksState>((set, get) => ({
  bookmarks: [],
  tagRegistry: [],
  loaded: false,
  fetching: new Set<string>(),
  tagFilter: null,

  setTagFilter: (tag) => set({ tagFilter: tag }),

  load: async () => {
    try {
      const snapshot = await collectionsDesktop.snapshot();
      const bookmarks = snapshot.bookmarks;
      const tagRegistry = snapshot.bookmarkTags;
      set({ bookmarks, tagRegistry, loaded: true });
      // pick up bookmarks whose metadata never arrived (e.g. app closed mid-fetch)
      for (const bookmark of bookmarks) {
        if (!bookmark.metaFetched) get().fetchMeta(bookmark.id);
      }
    } catch (err) {
      oops(err);
    }
  },

  add: async (url, tags) => {
    try {
      const { item: bookmark } = await collectionsDesktop.bookmarks.create(url, tags);
      set({ bookmarks: [bookmark, ...get().bookmarks] });
      get().fetchMeta(bookmark.id);
    } catch (err) {
      oops(err);
    }
  },

  fetchMeta: async (id) => {
    if (get().fetching.has(id)) return;
    set({ fetching: new Set(get().fetching).add(id) });
    try {
      const { item: updated } = await collectionsDesktop.bookmarks.fetchMetadata(id);
      set({
        bookmarks: get().bookmarks.map((b) => (b.id === id ? updated : b)),
      });
    } catch {
      // fetch failure already persisted as metaFetched; card offers retry
    } finally {
      const fetching = new Set(get().fetching);
      fetching.delete(id);
      set({ fetching });
    }
  },

  updateTitle: async (id, title) => {
    try {
      const { item: updated } = await collectionsDesktop.bookmarks.change(id, { type: "title", title });
      set({
        bookmarks: get().bookmarks.map((b) => (b.id === id ? updated : b)),
      });
    } catch (err) {
      oops(err);
    }
  },

  setTags: async (id, tags) => {
    try {
      const { item: updated } = await collectionsDesktop.bookmarks.change(id, { type: "tags", tags });
      // backend auto-registers any new tag names — merge them in
      const registry = new Set(get().tagRegistry);
      updated.tags.forEach((t) => registry.add(t));
      set({
        bookmarks: get().bookmarks.map((b) => (b.id === id ? updated : b)),
        tagRegistry: [...registry],
      });
    } catch (err) {
      oops(err);
    }
  },

  createTag: async (name) => {
    try {
      set({ tagRegistry: (await collectionsDesktop.tags.create("bookmarks", name)).bookmarkTags });
    } catch (err) {
      oops(err);
    }
  },

  deleteTag: async (name) => {
    try {
      const tagRegistry = (await collectionsDesktop.tags.remove("bookmarks", name)).bookmarkTags;
      set({
        tagRegistry,
        tagFilter: get().tagFilter === name ? null : get().tagFilter,
        bookmarks: get().bookmarks.map((b) => ({
          ...b,
          tags: b.tags.filter((t) => t !== name),
        })),
      });
    } catch (err) {
      oops(err);
    }
  },

  remove: async (id) => {
    set({ bookmarks: get().bookmarks.filter((b) => b.id !== id) });
    try {
      await collectionsDesktop.bookmarks.remove(id);
    } catch (err) {
      oops(err);
      get().load();
    }
  },

  exportAll: async () => {
    if (get().bookmarks.length === 0) {
      toast("Nothing to export yet.");
      return;
    }
    try {
      const path = await collectionsDesktop.bookmarks.export();
      if (path) {
        toast("Bookmarks exported", { description: path });
      }
    } catch (err) {
      oops(err);
    }
  },
}));
