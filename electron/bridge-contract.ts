import * as v from "valibot";

const operationIdSchema = v.pipe(v.string(), v.minLength(1));
const epochSchema = v.pipe(v.number(), v.integer(), v.minValue(1));
const relSchema = v.string();
const entryRelSchema = v.pipe(v.string(), v.minLength(1));
const idSchema = v.pipe(v.string(), v.minLength(1));
const nonBlankSchema = v.pipe(v.string(), v.regex(/\S/));
const tagsSchema = v.array(v.string());
const exportNameSchema = v.pipe(
  v.string(),
  v.regex(/^[^/\\]+\.md$/),
);
export const windowKindSchema = v.picklist(["main", "quick-capture"]);

export const todoChangeSchema = v.variant("type", [
  v.object({ type: v.literal("toggle") }),
  v.object({ type: v.literal("text"), text: v.string() }),
  v.object({ type: v.literal("tags"), tags: tagsSchema }),
]);

export const bookmarkChangeSchema = v.variant("type", [
  v.object({ type: v.literal("title"), title: v.string() }),
  v.object({ type: v.literal("tags"), tags: tagsSchema }),
  v.object({
    type: v.literal("metadata"),
    title: v.optional(v.string()),
    image: v.optional(v.nullable(v.string())),
    favicon: v.optional(v.nullable(v.string())),
    fetched: v.boolean(),
  }),
]);

export const cloudAccountSchema = v.object({
  email: v.pipe(v.string(), v.email()),
  plan: v.picklist(["free", "cloud"]),
});
export const cloudAccountStatusSchema = v.object({ account: v.nullable(cloudAccountSchema) });
export const otpChallengeSchema = v.object({
  challengeId: v.pipe(v.string(), v.minLength(1)),
  email: v.pipe(v.string(), v.email()),
  expiresIn: v.pipe(v.number(), v.integer(), v.minValue(0)),
  resendAfter: v.pipe(v.number(), v.integer(), v.minValue(0)),
});
export const publishPageDraftSchema = v.object({
  rel: entryRelSchema,
  path: v.string(),
  title: v.pipe(v.string(), v.minLength(1)),
  markdown: v.string(),
});
const publishDraftSchema = v.object({
  rel: entryRelSchema,
  title: v.pipe(v.string(), v.minLength(1)),
  content: v.string(),
  pages: v.array(publishPageDraftSchema),
});
export const publishedShareSchema = v.object({
  id: v.pipe(v.string(), v.minLength(1)),
  entryId: v.pipe(v.string(), v.minLength(1)),
  slug: v.pipe(v.string(), v.minLength(1)),
  url: v.pipe(v.string(), v.url()),
  title: v.pipe(v.string(), v.minLength(1)),
  contentHash: v.pipe(v.string(), v.minLength(1)),
  publishedAt: v.number(),
  updatedAt: v.number(),
  pageCount: v.pipe(v.number(), v.integer(), v.minValue(0)),
  assetCount: v.pipe(v.number(), v.integer(), v.minValue(0)),
});
export const publishedNoteStatusSchema = v.object({
  account: v.nullable(cloudAccountSchema),
  share: v.nullable(publishedShareSchema),
  isOutdated: v.boolean(),
});

export const treeNodeSchema: v.GenericSchema = v.object({
  name: v.string(),
  rel: relSchema,
  kind: v.picklist(["folder", "note"]),
  children: v.optional(v.array(v.lazy(() => treeNodeSchema))),
  modifiedMs: v.number(),
});

export const vaultSnapshotSchema = v.object({
  root: v.pipe(v.string(), v.minLength(1)),
  name: v.pipe(v.string(), v.minLength(1)),
  tree: v.array(treeNodeSchema),
  theme: v.picklist(["system", "light", "dark"]),
});

const vaultIndexEntrySchema = v.object({
  rel: entryRelSchema,
  kind: v.picklist(["note", "folder"]),
  modifiedMs: v.number(),
});
const vaultChangeSchema = v.variant("kind", [
  v.object({
    kind: v.picklist(["created", "modified"]),
    entry: vaultIndexEntrySchema,
  }),
  v.object({ kind: v.literal("removed"), rel: entryRelSchema }),
]);

export const vaultIndexEventSchema = v.variant("kind", [
  v.object({
    kind: v.literal("replacement"),
    indexEpoch: epochSchema,
    sequence: v.literal(0),
    snapshot: vaultSnapshotSchema,
  }),
  v.object({
    kind: v.literal("changes"),
    indexEpoch: epochSchema,
    sequence: epochSchema,
    changes: v.array(vaultChangeSchema),
  }),
]);

export const vaultIndexMessageSchema = v.object({
  type: v.literal("vault-index"),
  epoch: epochSchema,
  event: vaultIndexEventSchema,
});

export const pinSnapshotSchema = v.object({
  pins: v.array(relSchema),
  stale: v.array(relSchema),
});

export const searchHitSchema = v.object({
  rel: entryRelSchema,
  title: v.string(),
  snippet: v.string(),
  titleMatch: v.boolean(),
});

export const backlinkMentionSchema = v.object({
  sourceRel: entryRelSchema,
  context: v.string(),
  line: v.pipe(v.number(), v.integer(), v.minValue(1)),
  occurrence: v.pipe(v.number(), v.integer(), v.minValue(0)),
});

export const todoSchema = v.object({
  id: v.pipe(v.string(), v.minLength(1)),
  text: v.pipe(v.string(), v.minLength(1)),
  done: v.boolean(),
  createdAt: v.number(),
  completedAt: v.optional(v.nullable(v.number()), null),
  tags: v.optional(v.array(v.string()), []),
});

export const bookmarkSchema = v.object({
  id: v.pipe(v.string(), v.minLength(1)),
  url: v.pipe(v.string(), v.minLength(1)),
  title: v.pipe(v.string(), v.minLength(1)),
  image: v.optional(v.nullable(v.string()), null),
  favicon: v.optional(v.nullable(v.string()), null),
  metaFetched: v.optional(v.boolean(), false),
  tags: v.optional(v.array(v.string()), []),
  createdAt: v.number(),
});

export const collectionsSnapshotSchema = v.object({
  todos: v.array(todoSchema),
  todoTags: v.array(v.string()),
  bookmarks: v.array(bookmarkSchema),
  bookmarkTags: v.array(v.string()),
});

export const desktopErrorSchema = v.object({
  kind: v.pipe(v.string(), v.minLength(1)),
  message: v.pipe(v.string(), v.minLength(1)),
  details: v.optional(v.unknown()),
});

export const desktopUpdateSchema = v.object({
  id: idSchema,
  currentVersion: idSchema,
  version: idSchema,
  body: v.optional(v.string()),
  rawJson: v.optional(v.record(v.string(), v.unknown())),
});

export const engineRequestSchema = v.variant("method", [
  v.object({
    type: v.literal("request"),
    id: operationIdSchema,
    method: v.literal("vault.startup"),
    params: v.null(),
  }),
  v.object({
    type: v.literal("request"),
    id: operationIdSchema,
    method: v.literal("vault.open"),
    params: v.object({ root: v.pipe(v.string(), v.minLength(1)), create: v.boolean() }),
  }),
  v.object({
    type: v.literal("request"),
    id: operationIdSchema,
    method: v.literal("vault.snapshot"),
    params: v.null(),
  }),
  v.object({
    type: v.literal("request"),
    id: operationIdSchema,
    method: v.literal("vault.index.rescan"),
    params: v.null(),
  }),
  v.object({
    type: v.literal("request"),
    id: operationIdSchema,
    method: v.literal("vault.index.synchronize"),
    params: v.null(),
  }),
  v.object({
    type: v.literal("request"),
    id: operationIdSchema,
    method: v.literal("vault.note.create"),
    params: v.object({ dir: relSchema, title: v.string(), content: v.string() }),
  }),
  v.object({
    type: v.literal("request"),
    id: operationIdSchema,
    method: v.literal("vault.note.read"),
    params: v.object({ rel: relSchema }),
  }),
  v.object({
    type: v.literal("request"),
    id: operationIdSchema,
    method: v.literal("vault.note.write"),
    params: v.object({
      rel: relSchema,
      content: v.string(),
      expectedContent: v.string(),
    }),
  }),
  v.object({
    type: v.literal("request"),
    id: operationIdSchema,
    method: v.literal("vault.trash"),
    params: v.object({ rel: relSchema }),
  }),
  v.object({
    type: v.literal("request"),
    id: operationIdSchema,
    method: v.literal("vault.note.path"),
    params: v.object({ rel: entryRelSchema }),
  }),
  v.object({
    type: v.literal("request"),
    id: operationIdSchema,
    method: v.literal("vault.search"),
    params: v.object({
      query: v.pipe(v.string(), v.maxLength(512)),
      limit: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(100)),
    }),
  }),
  v.object({
    type: v.literal("request"),
    id: operationIdSchema,
    method: v.literal("vault.search.recordAccess"),
    params: v.object({ rel: entryRelSchema }),
  }),
  v.object({
    type: v.literal("request"),
    id: operationIdSchema,
    method: v.literal("vault.backlinks"),
    params: v.object({ rel: entryRelSchema }),
  }),
  v.object({
    type: v.literal("request"),
    id: operationIdSchema,
    method: v.literal("vault.pins.list"),
    params: v.null(),
  }),
  v.object({
    type: v.literal("request"),
    id: operationIdSchema,
    method: v.literal("vault.pins.add"),
    params: v.object({ rel: entryRelSchema }),
  }),
  v.object({
    type: v.literal("request"),
    id: operationIdSchema,
    method: v.literal("vault.pins.remove"),
    params: v.object({ rel: entryRelSchema }),
  }),
  v.object({
    type: v.literal("request"),
    id: operationIdSchema,
    method: v.literal("vault.asset.save"),
    params: v.object({
      data: v.pipe(v.string(), v.minLength(1), v.maxLength(35_000_000)),
      extension: v.pipe(v.string(), v.minLength(1), v.maxLength(16)),
    }),
  }),
  v.object({
    type: v.literal("request"),
    id: operationIdSchema,
    method: v.literal("vault.note.export"),
    params: v.object({ rel: entryRelSchema, content: v.string() }),
  }),
  v.object({
    type: v.literal("request"),
    id: operationIdSchema,
    method: v.literal("collections.snapshot"),
    params: v.null(),
  }),
  v.object({
    type: v.literal("request"),
    id: operationIdSchema,
    method: v.literal("collections.todos.create"),
    params: v.object({ text: v.string(), tags: tagsSchema }),
  }),
  v.object({
    type: v.literal("request"),
    id: operationIdSchema,
    method: v.literal("collections.todos.change"),
    params: v.object({ id: idSchema, change: todoChangeSchema }),
  }),
  v.object({
    type: v.literal("request"),
    id: operationIdSchema,
    method: v.literal("collections.todos.remove"),
    params: v.object({ id: idSchema }),
  }),
  v.object({
    type: v.literal("request"),
    id: operationIdSchema,
    method: v.literal("collections.todos.clearCompleted"),
    params: v.null(),
  }),
  v.object({
    type: v.literal("request"),
    id: operationIdSchema,
    method: v.literal("collections.bookmarks.create"),
    params: v.object({ url: v.string(), tags: tagsSchema }),
  }),
  v.object({
    type: v.literal("request"),
    id: operationIdSchema,
    method: v.literal("collections.bookmarks.change"),
    params: v.object({ id: idSchema, change: bookmarkChangeSchema }),
  }),
  v.object({
    type: v.literal("request"),
    id: operationIdSchema,
    method: v.literal("collections.bookmarks.remove"),
    params: v.object({ id: idSchema }),
  }),
  v.object({
    type: v.literal("request"),
    id: operationIdSchema,
    method: v.literal("collections.tags.create"),
    params: v.object({ collection: v.picklist(["todos", "bookmarks"]), name: v.string() }),
  }),
  v.object({
    type: v.literal("request"),
    id: operationIdSchema,
    method: v.literal("collections.tags.delete"),
    params: v.object({ collection: v.picklist(["todos", "bookmarks"]), name: v.string() }),
  }),
  v.object({
    type: v.literal("request"),
    id: operationIdSchema,
    method: v.literal("capture.create"),
    params: v.object({ title: v.string(), content: v.string() }),
  }),
  v.object({
    type: v.literal("request"),
    id: operationIdSchema,
    method: v.literal("capture.append"),
    params: v.object({ rel: entryRelSchema, content: nonBlankSchema }),
  }),
  v.object({
    type: v.literal("request"),
    id: operationIdSchema,
    method: v.literal("collections.bookmarks.export"),
    params: v.null(),
  }),
  v.object({ type: v.literal("request"), id: operationIdSchema, method: v.literal("cloud.account.status"), params: v.null() }),
  v.object({ type: v.literal("request"), id: operationIdSchema, method: v.literal("cloud.auth.requestOtp"), params: v.object({ email: v.pipe(v.string(), v.email()) }) }),
  v.object({ type: v.literal("request"), id: operationIdSchema, method: v.literal("cloud.auth.verifyOtp"), params: v.object({ challengeId: entryRelSchema, code: v.pipe(v.string(), v.minLength(1)) }) }),
  v.object({ type: v.literal("request"), id: operationIdSchema, method: v.literal("cloud.auth.signOut"), params: v.null() }),
  v.object({ type: v.literal("request"), id: operationIdSchema, method: v.literal("cloud.billing.plansUrl"), params: v.null() }),
  v.object({ type: v.literal("request"), id: operationIdSchema, method: v.literal("cloud.billing.portalUrl"), params: v.null() }),
  v.object({ type: v.literal("request"), id: operationIdSchema, method: v.literal("cloud.publish.status"), params: publishDraftSchema }),
  v.object({ type: v.literal("request"), id: operationIdSchema, method: v.literal("cloud.publish.isPublished"), params: v.object({ rel: entryRelSchema }) }),
  v.object({ type: v.literal("request"), id: operationIdSchema, method: v.literal("cloud.publish.create"), params: publishDraftSchema }),
  v.object({ type: v.literal("request"), id: operationIdSchema, method: v.literal("cloud.publish.update"), params: publishDraftSchema }),
  v.object({ type: v.literal("request"), id: operationIdSchema, method: v.literal("cloud.publish.revoke"), params: v.object({ rel: entryRelSchema }) }),
]);

export const controlRequestSchema = v.variant("method", [
  v.object({
    type: v.literal("request"),
    id: operationIdSchema,
    method: v.literal("dialog.chooseVault"),
    params: v.null(),
  }),
  v.object({
    type: v.literal("request"),
    id: operationIdSchema,
    method: v.literal("dialog.createVault"),
    params: v.null(),
  }),
  v.object({
    type: v.literal("request"),
    id: operationIdSchema,
    method: v.literal("updates.check"),
    params: v.null(),
  }),
  v.object({
    type: v.literal("request"),
    id: operationIdSchema,
    method: v.literal("updates.install"),
    params: v.object({ id: v.pipe(v.string(), v.minLength(1)) }),
  }),
  v.object({
    type: v.literal("request"),
    id: operationIdSchema,
    method: v.literal("app.relaunch"),
    params: v.null(),
  }),
  v.object({
    type: v.literal("request"),
    id: operationIdSchema,
    method: v.literal("capture.open"),
    params: v.null(),
  }),
  v.object({
    type: v.literal("request"),
    id: operationIdSchema,
    method: v.literal("capture.close"),
    params: v.null(),
  }),
  v.object({
    type: v.literal("request"),
    id: operationIdSchema,
    method: v.literal("external.open"),
    params: v.object({ url: v.pipe(v.string(), v.url()) }),
  }),
]);

export const engineReadySchema = v.object({
  type: v.literal("ready"),
  epoch: epochSchema,
});

export const engineResponseSchema = v.variant("ok", [
  v.object({
    type: v.literal("response"),
    id: operationIdSchema,
    epoch: epochSchema,
    ok: v.literal(true),
    value: v.unknown(),
  }),
  v.object({
    type: v.literal("response"),
    id: operationIdSchema,
    epoch: epochSchema,
    ok: v.literal(false),
    error: desktopErrorSchema,
  }),
]);

export const engineMessageSchema = v.variant("type", [
  engineReadySchema,
  engineResponseSchema,
  vaultIndexMessageSchema,
]);

export const controlResponseSchema = v.variant("ok", [
  v.object({
    type: v.literal("response"),
    id: operationIdSchema,
    ok: v.literal(true),
    value: v.unknown(),
  }),
  v.object({
    type: v.literal("response"),
    id: operationIdSchema,
    ok: v.literal(false),
    error: desktopErrorSchema,
  }),
]);

export const enginePortMetadataSchema = v.object({
  epoch: epochSchema,
  windowKind: windowKindSchema,
});

export const engineControlSchema = v.object({ epoch: epochSchema });

export const engineConnectSchema = v.object({
  type: v.literal("connect"),
  epoch: epochSchema,
  configDir: v.pipe(v.string(), v.minLength(1)),
  windowKind: windowKindSchema,
});

export const nativeRequestSchema = v.variant("method", [
  v.object({
    type: v.literal("native-request"),
    id: operationIdSchema,
    epoch: epochSchema,
    method: v.literal("trash"),
    root: v.pipe(v.string(), v.minLength(1)),
    path: v.pipe(v.string(), v.minLength(1)),
  }),
  v.object({
    type: v.literal("native-request"),
    id: operationIdSchema,
    epoch: epochSchema,
    method: v.literal("asset-root.stage"),
    root: v.pipe(v.string(), v.minLength(1)),
    assetRoot: v.pipe(v.string(), v.minLength(1)),
  }),
  v.object({
    type: v.literal("native-request"),
    id: operationIdSchema,
    epoch: epochSchema,
    method: v.literal("asset-root.commit"),
    stageId: operationIdSchema,
  }),
  v.object({
    type: v.literal("native-request"),
    id: operationIdSchema,
    epoch: epochSchema,
    method: v.literal("asset-root.rollback"),
    stageId: operationIdSchema,
  }),
  v.object({
    type: v.literal("native-request"),
    id: operationIdSchema,
    epoch: epochSchema,
    method: v.literal("export.save"),
    windowKind: v.literal("main"),
    suggestedName: exportNameSchema,
    content: v.string(),
  }),
]);

export const nativeResponseSchema = v.variant("ok", [
  v.object({
    type: v.literal("native-response"),
    id: operationIdSchema,
    epoch: epochSchema,
    ok: v.literal(true),
    value: v.unknown(),
  }),
  v.object({
    type: v.literal("native-response"),
    id: operationIdSchema,
    epoch: epochSchema,
    ok: v.literal(false),
    error: desktopErrorSchema,
  }),
]);

export const engineChannelFailureSchema = v.object({
  reason: v.literal("invalid-channel"),
});

export const engineStateSchema = v.variant("state", [
  v.object({
    state: v.literal("starting"),
    epoch: epochSchema,
  }),
  v.object({
    state: v.literal("ready"),
    epoch: epochSchema,
  }),
  v.object({
    state: v.literal("unavailable"),
    epoch: epochSchema,
    error: desktopErrorSchema,
  }),
]);

export type DesktopErrorData = v.InferOutput<typeof desktopErrorSchema>;
export type EngineRequest = v.InferOutput<typeof engineRequestSchema>;
export type ControlRequest = v.InferOutput<typeof controlRequestSchema>;
export type EngineMessage = v.InferOutput<typeof engineMessageSchema>;
export type EngineResponse = v.InferOutput<typeof engineResponseSchema>;
export type ControlResponse = v.InferOutput<typeof controlResponseSchema>;
export type EngineState = v.InferOutput<typeof engineStateSchema>;
export type NativeRequest = v.InferOutput<typeof nativeRequestSchema>;
export type VaultIndexEventData = v.InferOutput<typeof vaultIndexEventSchema>;

export function validateResponseValue(
  method: EngineRequest["method"] | ControlRequest["method"],
  value: unknown,
): boolean {
  switch (method) {
    case "vault.startup":
    case "vault.open":
    case "vault.snapshot":
      return v.safeParse(v.nullable(vaultSnapshotSchema), value).success;
    case "vault.index.rescan":
      return v.safeParse(v.null(), value).success;
    case "vault.index.synchronize":
      return v.safeParse(v.nullable(vaultIndexEventSchema), value).success;
    case "vault.note.create":
      return v.safeParse(v.object({ rel: relSchema, snapshot: vaultSnapshotSchema }), value)
        .success;
    case "vault.note.read":
      return v.safeParse(v.string(), value).success;
    case "vault.note.write":
      return v.safeParse(v.string(), value).success;
    case "vault.trash":
      return v.safeParse(v.object({ snapshot: vaultSnapshotSchema }), value).success;
    case "vault.note.path":
      return v.safeParse(v.pipe(v.string(), v.minLength(1)), value).success;
    case "vault.search":
      return v.safeParse(v.array(searchHitSchema), value).success;
    case "vault.search.recordAccess":
      return v.safeParse(v.null(), value).success;
    case "vault.backlinks":
      return v.safeParse(v.array(backlinkMentionSchema), value).success;
    case "vault.asset.save":
      return v.safeParse(v.pipe(v.string(), v.regex(/^\.markd\/assets\/[^/]+$/)), value).success;
    case "vault.note.export":
    case "collections.bookmarks.export":
      return v.safeParse(v.nullable(v.pipe(v.string(), v.minLength(1))), value).success;
    case "vault.pins.list":
    case "vault.pins.add":
    case "vault.pins.remove":
      return v.safeParse(pinSnapshotSchema, value).success;
    case "collections.snapshot":
    case "collections.todos.remove":
    case "collections.todos.clearCompleted":
    case "collections.bookmarks.remove":
    case "collections.tags.create":
    case "collections.tags.delete":
      return v.safeParse(collectionsSnapshotSchema, value).success;
    case "collections.todos.create":
    case "collections.todos.change":
      return v.safeParse(v.object({ snapshot: collectionsSnapshotSchema, item: todoSchema }), value)
        .success;
    case "collections.bookmarks.create":
    case "collections.bookmarks.change":
      return v.safeParse(
        v.object({ snapshot: collectionsSnapshotSchema, item: bookmarkSchema }),
        value,
      ).success;
    case "capture.create":
    case "capture.append":
      return v.safeParse(v.object({ rel: relSchema, snapshot: vaultSnapshotSchema }), value).success;
    case "cloud.account.status":
      return v.safeParse(cloudAccountStatusSchema, value).success;
    case "cloud.auth.requestOtp":
      return v.safeParse(otpChallengeSchema, value).success;
    case "cloud.auth.verifyOtp":
      return v.safeParse(cloudAccountSchema, value).success;
    case "cloud.auth.signOut":
    case "cloud.publish.revoke":
      return v.safeParse(v.null(), value).success;
    case "cloud.billing.plansUrl":
    case "cloud.billing.portalUrl":
      return v.safeParse(v.pipe(v.string(), v.url()), value).success;
    case "cloud.publish.status":
      return v.safeParse(publishedNoteStatusSchema, value).success;
    case "cloud.publish.isPublished":
      return v.safeParse(v.boolean(), value).success;
    case "cloud.publish.create":
    case "cloud.publish.update":
      return v.safeParse(publishedShareSchema, value).success;
    case "dialog.chooseVault":
    case "dialog.createVault":
      return v.safeParse(v.nullable(v.string()), value).success;
    case "updates.check":
      return v.safeParse(v.nullable(desktopUpdateSchema), value).success;
    case "updates.install":
    case "app.relaunch":
    case "capture.open":
    case "capture.close":
    case "external.open":
      return v.safeParse(v.null(), value).success;
  }
}
