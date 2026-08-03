import type {
  Bookmark,
  BookmarkChange,
  CollectionKind,
  CollectionsSnapshot,
  Todo,
  TodoChange,
} from "../src/lib/types";

export type { BookmarkChange, CollectionKind, CollectionsSnapshot, TodoChange };

export class CollectionDomainError extends Error {
  readonly kind: "INVALID_INPUT" | "NOT_FOUND";

  constructor(kind: "INVALID_INPUT" | "NOT_FOUND", message: string) {
    super(message);
    this.name = "CollectionDomainError";
    this.kind = kind;
  }
}

export function emptyCollections(): CollectionsSnapshot {
  return { todos: [], todoTags: [], bookmarks: [], bookmarkTags: [] };
}

export function addTodo(
  snapshot: CollectionsSnapshot,
  text: string,
  tags: string[],
  identity: { id: string; now: number },
): { snapshot: CollectionsSnapshot; item: Todo } {
  const normalizedText = requiredText(text, "Todo text is empty.");
  const normalizedTags = normalizeTags(tags);
  const item: Todo = {
    id: identity.id,
    text: normalizedText,
    done: false,
    createdAt: identity.now,
    completedAt: null,
    tags: normalizedTags,
  };
  return {
    item,
    snapshot: {
      ...snapshot,
      todos: [item, ...snapshot.todos],
      todoTags: registerTags(snapshot.todoTags, normalizedTags),
    },
  };
}

export function changeTodo(
  snapshot: CollectionsSnapshot,
  id: string,
  change: TodoChange,
  now: number,
): { snapshot: CollectionsSnapshot; item: Todo } {
  const current = findItem(snapshot.todos, id, "Todo");
  let item: Todo;
  switch (change.type) {
    case "toggle": {
      const done = !current.done;
      item = { ...current, done, completedAt: done ? now : null };
      break;
    }
    case "text":
      item = { ...current, text: requiredText(change.text, "Todo text is empty.") };
      break;
    case "tags":
      item = { ...current, tags: normalizeTags(change.tags) };
      break;
  }
  return {
    item,
    snapshot: {
      ...snapshot,
      todos: replaceItem(snapshot.todos, item),
      todoTags: registerTags(snapshot.todoTags, item.tags),
    },
  };
}

export function removeTodo(snapshot: CollectionsSnapshot, id: string): CollectionsSnapshot {
  findItem(snapshot.todos, id, "Todo");
  return { ...snapshot, todos: snapshot.todos.filter((item) => item.id !== id) };
}

export function clearCompletedTodos(snapshot: CollectionsSnapshot): CollectionsSnapshot {
  return { ...snapshot, todos: snapshot.todos.filter((item) => !item.done) };
}

export function addBookmark(
  snapshot: CollectionsSnapshot,
  input: string,
  tags: string[],
  identity: { id: string; now: number },
): { snapshot: CollectionsSnapshot; item: Bookmark } {
  const url = normalizeUrl(input);
  const normalizedTags = normalizeTags(tags);
  const item: Bookmark = {
    id: identity.id,
    url,
    title: placeholderTitle(url),
    image: null,
    favicon: null,
    metaFetched: false,
    tags: normalizedTags,
    createdAt: identity.now,
  };
  return {
    item,
    snapshot: {
      ...snapshot,
      bookmarks: [item, ...snapshot.bookmarks],
      bookmarkTags: registerTags(snapshot.bookmarkTags, normalizedTags),
    },
  };
}

export function changeBookmark(
  snapshot: CollectionsSnapshot,
  id: string,
  change: BookmarkChange,
): { snapshot: CollectionsSnapshot; item: Bookmark } {
  const current = findItem(snapshot.bookmarks, id, "Bookmark");
  let item: Bookmark;
  switch (change.type) {
    case "title":
      item = { ...current, title: requiredText(change.title, "Bookmark title is empty.") };
      break;
    case "tags":
      item = { ...current, tags: normalizeTags(change.tags) };
      break;
    case "metadata":
      item = {
        ...current,
        title: change.title?.trim() || current.title,
        image: change.image === undefined ? current.image : change.image,
        favicon: change.favicon === undefined ? current.favicon : change.favicon,
        metaFetched: change.fetched,
      };
      break;
  }
  return {
    item,
    snapshot: {
      ...snapshot,
      bookmarks: replaceItem(snapshot.bookmarks, item),
      bookmarkTags: registerTags(snapshot.bookmarkTags, item.tags),
    },
  };
}

export function removeBookmark(snapshot: CollectionsSnapshot, id: string): CollectionsSnapshot {
  findItem(snapshot.bookmarks, id, "Bookmark");
  return {
    ...snapshot,
    bookmarks: snapshot.bookmarks.filter((item) => item.id !== id),
  };
}

export function createCollectionTag(
  snapshot: CollectionsSnapshot,
  collection: CollectionKind,
  name: string,
): CollectionsSnapshot {
  const tags = normalizeTags([name]);
  if (tags.length === 0) {
    throw new CollectionDomainError("INVALID_INPUT", "Tag is empty or too long.");
  }
  const key = collection === "todos" ? "todoTags" : "bookmarkTags";
  return { ...snapshot, [key]: registerTags(snapshot[key], tags) };
}

export function deleteCollectionTag(
  snapshot: CollectionsSnapshot,
  collection: CollectionKind,
  name: string,
): CollectionsSnapshot {
  const normalized = normalizeTags([name])[0];
  if (!normalized) {
    throw new CollectionDomainError("INVALID_INPUT", "Tag is empty or too long.");
  }
  if (collection === "todos") {
    return {
      ...snapshot,
      todoTags: snapshot.todoTags.filter((tag) => tag !== normalized),
      todos: snapshot.todos.map((item) => ({
        ...item,
        tags: item.tags.filter((tag) => tag !== normalized),
      })),
    };
  }
  return {
    ...snapshot,
    bookmarkTags: snapshot.bookmarkTags.filter((tag) => tag !== normalized),
    bookmarks: snapshot.bookmarks.map((item) => ({
      ...item,
      tags: item.tags.filter((tag) => tag !== normalized),
    })),
  };
}

function normalizeTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const input of tags) {
    const tag = input.trim().replace(/^#+/, "").trim().toLowerCase();
    if (!tag || tag.length > 32 || seen.has(tag)) continue;
    seen.add(tag);
    normalized.push(tag);
  }
  return normalized;
}

function registerTags(registry: string[], incoming: string[]): string[] {
  return [...registry, ...incoming.filter((tag) => !registry.includes(tag))];
}

function requiredText(value: string, message: string): string {
  const text = value.trim();
  if (!text) throw new CollectionDomainError("INVALID_INPUT", message);
  return text;
}

function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) throw new CollectionDomainError("INVALID_INPUT", "Bookmark URL is empty.");
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) && !/^https?:\/\//i.test(trimmed)) {
    throw new CollectionDomainError("INVALID_INPUT", "Bookmark URL must use HTTP or HTTPS.");
  }
  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new CollectionDomainError("INVALID_INPUT", "Bookmark URL is invalid.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new CollectionDomainError("INVALID_INPUT", "Bookmark URL must use HTTP or HTTPS.");
  }
  return url.toString().replace(/\/$/, trimmed.endsWith("/") ? "/" : "");
}

function placeholderTitle(url: string): string {
  return url
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/$/, "");
}

function findItem<T extends { id: string }>(items: T[], id: string, label: string): T {
  const item = items.find((candidate) => candidate.id === id);
  if (!item) throw new CollectionDomainError("NOT_FOUND", `${label} does not exist: ${id}`);
  return item;
}

function replaceItem<T extends { id: string }>(items: T[], item: T): T[] {
  return items.map((candidate) => (candidate.id === item.id ? item : candidate));
}
