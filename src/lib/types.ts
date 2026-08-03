export type Theme = "system" | "light" | "dark";

export type NodeKind = "folder" | "note";

export interface TreeNode {
  name: string;
  /** Path relative to the vault root, e.g. "projects/app.md". */
  rel: string;
  kind: NodeKind;
  children?: TreeNode[];
  modifiedMs: number;
}

export interface VaultSnapshot {
  root: string;
  name: string;
  tree: TreeNode[];
  theme: Theme;
}

export type PinSnapshot = {
  pins: string[];
  stale: string[];
};

export interface Todo {
  id: string;
  text: string;
  done: boolean;
  createdAt: number;
  completedAt: number | null;
  tags: string[];
}

export interface Bookmark {
  id: string;
  url: string;
  title: string;
  image: string | null;
  favicon: string | null;
  metaFetched: boolean;
  tags: string[];
  createdAt: number;
}

export type CollectionsSnapshot = {
  todos: Todo[];
  todoTags: string[];
  bookmarks: Bookmark[];
  bookmarkTags: string[];
};

export type CollectionKind = "todos" | "bookmarks";

export type TodoChange =
  | { type: "toggle" }
  | { type: "text"; text: string }
  | { type: "tags"; tags: string[] };

export type BookmarkChange =
  | { type: "title"; title: string }
  | { type: "tags"; tags: string[] }
  | {
      type: "metadata";
      title?: string;
      image?: string | null;
      favicon?: string | null;
      fetched: boolean;
    };

export interface SearchHit {
  rel: string;
  title: string;
  snippet: string;
  titleMatch: boolean;
}

export interface BacklinkMention {
  sourceRel: string;
  context: string;
  line: number;
  occurrence: number;
}

export interface PublishedShare {
  id: string;
  entryId: string;
  slug: string;
  url: string;
  title: string;
  contentHash: string;
  publishedAt: number;
  updatedAt: number;
  pageCount: number;
  assetCount: number;
}

export interface PublishPageDraft {
  rel: string;
  path: string;
  title: string;
  markdown: string;
}

export interface CloudAccount {
  email: string;
  plan: "free" | "cloud";
}

export interface CloudAccountStatus {
  account: CloudAccount | null;
}

export interface OtpChallenge {
  challengeId: string;
  email: string;
  expiresIn: number;
  resendAfter: number;
}

export interface PublishedNoteStatus {
  account: CloudAccount | null;
  share: PublishedShare | null;
  isOutdated: boolean;
}

export type View = { type: "note"; rel: string } | { type: "todos" } | { type: "bookmarks" };
