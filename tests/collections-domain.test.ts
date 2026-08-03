import { describe, expect, test } from "vitest";
import {
  addBookmark,
  addTodo,
  changeBookmark,
  changeTodo,
  deleteCollectionTag,
  emptyCollections,
} from "../electron/collections-domain";

describe("Collections domain", () => {
  test("creates and changes Todos without mutating the previous snapshot", () => {
    const initial = emptyCollections();
    const created = addTodo(initial, "  Ship Collections  ", ["#Work", "work"], {
      id: "todo-1",
      now: 100,
    });
    const toggled = changeTodo(created.snapshot, "todo-1", { type: "toggle" }, 200);

    expect(initial).toEqual({
      todos: [],
      todoTags: [],
      bookmarks: [],
      bookmarkTags: [],
    });
    expect(created.item).toEqual({
      id: "todo-1",
      text: "Ship Collections",
      done: false,
      createdAt: 100,
      completedAt: null,
      tags: ["work"],
    });
    expect(toggled.item).toEqual({
      ...created.item,
      done: true,
      completedAt: 200,
    });
    expect(toggled.snapshot.todoTags).toEqual(["work"]);
  });

  test("normalizes Bookmarks and removes deleted tags from every item", () => {
    const created = addBookmark(emptyCollections(), " example.com/read ", ["Later"], {
      id: "bookmark-1",
      now: 300,
    });
    const renamed = changeBookmark(created.snapshot, "bookmark-1", {
      type: "title",
      title: "  Read this  ",
    });
    const withoutTag = deleteCollectionTag(renamed.snapshot, "bookmarks", "later");

    expect(created.item).toEqual({
      id: "bookmark-1",
      url: "https://example.com/read",
      title: "example.com/read",
      image: null,
      favicon: null,
      metaFetched: false,
      tags: ["later"],
      createdAt: 300,
    });
    expect(renamed.item.title).toBe("Read this");
    expect(withoutTag.bookmarkTags).toEqual([]);
    expect(withoutTag.bookmarks[0]?.tags).toEqual([]);
  });

  test("returns tagged failures for invalid input and missing items", () => {
    expect(() => addTodo(emptyCollections(), "   ", [], { id: "x", now: 1 })).toThrowError(
      expect.objectContaining({ kind: "INVALID_INPUT" }),
    );
    expect(() => changeTodo(emptyCollections(), "missing", { type: "toggle" }, 1)).toThrowError(
      expect.objectContaining({ kind: "NOT_FOUND" }),
    );
    expect(() =>
      addBookmark(emptyCollections(), "ftp://example.com", [], { id: "x", now: 1 }),
    ).toThrowError(expect.objectContaining({ kind: "INVALID_INPUT" }));
  });
});
