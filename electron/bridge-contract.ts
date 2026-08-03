import * as v from "valibot";

const operationIdSchema = v.pipe(v.string(), v.minLength(1));
const epochSchema = v.pipe(v.number(), v.integer(), v.minValue(1));

export const desktopErrorSchema = v.object({
  kind: v.pipe(v.string(), v.minLength(1)),
  message: v.pipe(v.string(), v.minLength(1)),
  details: v.optional(v.unknown()),
});

export const engineRequestSchema = v.object({
  type: v.literal("request"),
  id: operationIdSchema,
  method: v.literal("vault.startup"),
  params: v.null(),
});

export const controlRequestSchema = v.variant("method", [
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

export const enginePortMetadataSchema = v.object({ epoch: epochSchema });

export const engineControlSchema = v.object({ epoch: epochSchema });

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

export function validateResponseValue(
  method: EngineRequest["method"] | ControlRequest["method"],
  value: unknown,
): boolean {
  switch (method) {
    case "vault.startup":
    case "updates.check":
    case "updates.install":
    case "app.relaunch":
      // Phase 1 only promises an empty engine and updater shell. Later slices
      // replace these null handshakes with their frozen domain schemas.
      return v.safeParse(v.null(), value).success;
  }
}
