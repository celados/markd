import { create } from "@octanejs/zustand";
import { toast } from "@octanejs/sonner";
import { collectionsDesktop } from "@/lib/desktop-services";
import type { Todo } from "@/lib/types";

interface TodosState {
  todos: Todo[];
  tagRegistry: string[];
  loaded: boolean;
  /** active tag filter for the todos view (null = All) */
  tagFilter: string | null;
  setTagFilter: (tag: string | null) => void;
  load: () => Promise<void>;
  add: (text: string, tags?: string[]) => Promise<void>;
  toggle: (id: string) => Promise<void>;
  updateText: (id: string, text: string) => Promise<void>;
  setTags: (id: string, tags: string[]) => Promise<void>;
  createTag: (name: string) => Promise<void>;
  deleteTag: (name: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  clearCompleted: () => Promise<void>;
}

const oops = (err: unknown) =>
  toast.error(err instanceof Error ? err.message : String(err));

export const useTodos = create<TodosState>((set, get) => ({
  todos: [],
  tagRegistry: [],
  loaded: false,
  tagFilter: null,

  setTagFilter: (tag) => set({ tagFilter: tag }),

  load: async () => {
    try {
      const snapshot = await collectionsDesktop.snapshot();
      set({ todos: snapshot.todos, tagRegistry: snapshot.todoTags, loaded: true });
    } catch (err) {
      oops(err);
    }
  },

  add: async (text, tags) => {
    try {
      const { item: todo } = await collectionsDesktop.todos.create(text, tags);
      set({ todos: [todo, ...get().todos] });
    } catch (err) {
      oops(err);
    }
  },

  toggle: async (id) => {
    // optimistic — checkbox must feel instant
    set({
      todos: get().todos.map((t) => (t.id === id ? { ...t, done: !t.done } : t)),
    });
    try {
      const { item: updated } = await collectionsDesktop.todos.change(id, { type: "toggle" });
      set({ todos: get().todos.map((t) => (t.id === id ? updated : t)) });
    } catch (err) {
      oops(err);
      get().load();
    }
  },

  updateText: async (id, text) => {
    try {
      const { item: updated } = await collectionsDesktop.todos.change(id, { type: "text", text });
      set({ todos: get().todos.map((t) => (t.id === id ? updated : t)) });
    } catch (err) {
      oops(err);
    }
  },

  setTags: async (id, tags) => {
    try {
      const { item: updated } = await collectionsDesktop.todos.change(id, { type: "tags", tags });
      const registry = new Set(get().tagRegistry);
      updated.tags.forEach((t) => registry.add(t));
      set({
        todos: get().todos.map((t) => (t.id === id ? updated : t)),
        tagRegistry: [...registry],
      });
    } catch (err) {
      oops(err);
    }
  },

  createTag: async (name) => {
    try {
      set({ tagRegistry: (await collectionsDesktop.tags.create("todos", name)).todoTags });
    } catch (err) {
      oops(err);
    }
  },

  deleteTag: async (name) => {
    try {
      const tagRegistry = (await collectionsDesktop.tags.remove("todos", name)).todoTags;
      set({
        tagRegistry,
        tagFilter: get().tagFilter === name ? null : get().tagFilter,
        todos: get().todos.map((t) => ({
          ...t,
          tags: t.tags.filter((tag) => tag !== name),
        })),
      });
    } catch (err) {
      oops(err);
    }
  },

  remove: async (id) => {
    set({ todos: get().todos.filter((t) => t.id !== id) });
    try {
      await collectionsDesktop.todos.remove(id);
    } catch (err) {
      oops(err);
      get().load();
    }
  },

  clearCompleted: async () => {
    try {
      set({ todos: (await collectionsDesktop.todos.clearCompleted()).todos });
    } catch (err) {
      oops(err);
    }
  },
}));
