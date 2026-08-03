import { randomUUID } from "node:crypto";
import * as v from "valibot";
import {
  engineConnectSchema,
  engineReadySchema,
  engineRequestSchema,
  engineResponseSchema,
  nativeRequestSchema,
  nativeResponseSchema,
  type DesktopErrorData,
  type EngineRequest,
  type EngineResponse,
  type NativeRequest,
} from "./bridge-contract";
import { VaultEngine, VaultEngineError } from "./vault-engine";
import { CollectionsEngineError } from "./collections-engine";
import { RequestActor } from "./request-actor";
import { CloudEngine, CloudEngineError } from "./cloud-engine";
import { resolveCloudConfig } from "./cloud-config";

const parentPort = process.parentPort;
if (!parentPort) {
  throw new Error("Markd Engine requires an Electron utility-process parent port");
}

const abortDelay = Number(process.env.MARKD_ENGINE_TEST_ABORT_DELAY_MS ?? 0);
if (Number.isFinite(abortDelay) && abortDelay > 0) {
  setTimeout(() => process.abort(), abortDelay);
}

const nativeCalls = new Map<
  string,
  {
    epoch: number;
    method: NativeRequest["method"];
    resolve: (value: unknown) => void;
    reject: (error: VaultEngineError) => void;
  }
>();

let activeEpoch = 0;
let activeConfigDir = "";
let vault: VaultEngine | null = null;
let cloud: CloudEngine | null = null;
let initialization: Promise<void> | null = null;
const requests = new RequestActor();

parentPort.on("message", (event) => {
  const nativeResponse = v.safeParse(nativeResponseSchema, event.data);
  if (nativeResponse.success) {
    const call = nativeCalls.get(nativeResponse.output.id);
    if (!call || call.epoch !== nativeResponse.output.epoch) return;
    nativeCalls.delete(nativeResponse.output.id);
    if (nativeResponse.output.ok) {
      if (!validateNativeResponse(call.method, nativeResponse.output.value)) {
        call.reject(
          new VaultEngineError({
            kind: "INVALID_RESPONSE",
            message: "Markd Desktop returned an invalid native response.",
          }),
        );
        return;
      }
      call.resolve(nativeResponse.output.value);
    } else call.reject(new VaultEngineError(nativeResponse.output.error));
    return;
  }

  const connection = v.safeParse(engineConnectSchema, event.data);
  const port = event.ports[0];
  if (!connection.success || !port) {
    throw new Error("Markd Engine received an invalid renderer channel");
  }
  const { epoch, configDir, windowKind } = connection.output;
  if (!vault) {
    activeEpoch = epoch;
    activeConfigDir = configDir;
    vault = new VaultEngine(configDir, {
      moveToTrash: (root, path) => requestTrash(epoch, root, path),
      stageAssetRoot: (root, assetRoot) => requestAssetRootStage(epoch, root, assetRoot),
      commitAssetRoot: (stageId) => requestAssetRootCommit(epoch, stageId),
      rollbackAssetRoot: (stageId) => requestAssetRootRollback(epoch, stageId),
      saveExport: (preparation) => requestExportSave(epoch, "main", preparation),
    });
    cloud = new CloudEngine(configDir, () => vault!.activeRoot(), resolveCloudConfig(process.env));
    initialization = vault.startup().then(() => undefined);
  } else if (epoch !== activeEpoch || configDir !== activeConfigDir) {
    port.close();
    throw new Error("Markd Engine rejected a renderer from another generation");
  }
  const activeVault = vault;
  const activeCloud = cloud!;

  const becomeReady = () => {
    port.on("message", (messageEvent) => {
      const parsed = v.safeParse(engineRequestSchema, messageEvent.data);
      if (!parsed.success) {
        console.error("[markd-engine] rejected invalid request");
        process.exit(1);
        return;
      }
      // Every renderer gets its own MessagePort, so the utility process is the
      // only place that can impose one mutation order across editor + capture.
      void requests.enqueue(() =>
        handleRequest(activeVault, activeCloud, parsed.output, windowKind),
      )
        .then((value) =>
          respond(port, {
            type: "response",
            id: parsed.output.id,
            epoch,
            ok: true,
            value,
          }),
        )
        .catch((error: unknown) =>
          respond(port, {
            type: "response",
            id: parsed.output.id,
            epoch,
            ok: false,
            error: errorData(error),
          }),
        );
    });
    port.start();
    port.postMessage(v.parse(engineReadySchema, { type: "ready", epoch }));
    console.log(`[markd-engine] ready epoch=${epoch}`);
  };
  void initialization
    ?.then(() => {
      const delay = Number(process.env.MARKD_ENGINE_READY_DELAY_MS ?? 0);
      if (Number.isFinite(delay) && delay > 0) setTimeout(becomeReady, delay);
      else becomeReady();
    })
    .catch((error: unknown) => {
      console.error("[markd-engine] failed to restore the active Vault", error);
      process.exit(1);
    });
});

async function handleRequest(
  vault: VaultEngine,
  cloud: CloudEngine,
  request: EngineRequest,
  windowKind: "main" | "quick-capture",
): Promise<unknown> {
  if (request.method.startsWith("capture.")) {
    const delay = Number(process.env.MARKD_ENGINE_TEST_CAPTURE_DELAY_MS ?? 0);
    if (Number.isFinite(delay) && delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  switch (request.method) {
    case "vault.startup":
      return vault.startup();
    case "vault.open":
      return vault.open(request.params.root, request.params.create);
    case "vault.snapshot":
      return vault.snapshot();
    case "vault.note.create":
      return vault.createNote(request.params.dir, request.params.title, request.params.content);
    case "vault.note.read":
      return vault.readNote(request.params.rel);
    case "vault.note.write":
      return vault.writeNote(
        request.params.rel,
        request.params.content,
        request.params.expectedContent,
      );
    case "vault.trash":
      return vault.moveToTrash(request.params.rel);
    case "vault.note.path":
      return vault.resolveNotePath(request.params.rel);
    case "vault.pins.list":
      return vault.listPins();
    case "vault.pins.add":
      return vault.pin(request.params.rel);
    case "vault.pins.remove":
      return vault.unpin(request.params.rel);
    case "vault.asset.save":
      return vault.saveAsset(request.params.data, request.params.extension);
    case "vault.note.export":
      assertMainWindow(windowKind);
      return vault.exportNote(request.params.rel, request.params.content);
    case "collections.snapshot":
      return vault.collectionsSnapshot();
    case "collections.todos.create":
      return vault.createTodo(request.params.text, request.params.tags);
    case "collections.todos.change":
      return vault.changeTodo(request.params.id, request.params.change);
    case "collections.todos.remove":
      return vault.removeTodo(request.params.id);
    case "collections.todos.clearCompleted":
      return vault.clearCompletedTodos();
    case "collections.bookmarks.create":
      return vault.createBookmark(request.params.url, request.params.tags);
    case "collections.bookmarks.change":
      return vault.changeBookmark(request.params.id, request.params.change);
    case "collections.bookmarks.remove":
      return vault.removeBookmark(request.params.id);
    case "collections.tags.create":
      return vault.createCollectionTag(request.params.collection, request.params.name);
    case "collections.tags.delete":
      return vault.deleteCollectionTag(request.params.collection, request.params.name);
    case "capture.create":
      return vault.captureCreate(request.params.title, request.params.content);
    case "capture.append":
      return vault.captureAppend(request.params.rel, request.params.content);
    case "collections.bookmarks.export":
      assertMainWindow(windowKind);
      return vault.exportBookmarks();
    case "cloud.account.status":
      return cloud.accountStatus();
    case "cloud.auth.requestOtp":
      return cloud.requestOtp(request.params.email);
    case "cloud.auth.verifyOtp":
      return cloud.verifyOtp(request.params.challengeId, request.params.code);
    case "cloud.auth.signOut":
      await cloud.signOut();
      return null;
    case "cloud.billing.plansUrl":
      return cloud.plansUrl();
    case "cloud.billing.portalUrl":
      return cloud.portalUrl();
    case "cloud.publish.status":
      return cloud.status(request.params);
    case "cloud.publish.isPublished":
      return cloud.isPublished(request.params.rel);
    case "cloud.publish.create":
      return cloud.publish(request.params);
    case "cloud.publish.update":
      return cloud.update(request.params);
    case "cloud.publish.revoke":
      await cloud.revoke(request.params.rel);
      return null;
  }
}

function requestTrash(epoch: number, root: string, path: string): Promise<void> {
  const id = randomUUID();
  const request = v.parse(nativeRequestSchema, {
    type: "native-request",
    id,
    epoch,
    method: "trash",
    root,
    path,
  });
  return new Promise((resolve, reject) => {
    nativeCalls.set(id, {
      epoch,
      method: request.method,
      resolve: () => resolve(),
      reject,
    });
    parentPort.postMessage(request);
  });
}

function requestAssetRootStage(
  epoch: number,
  root: string,
  assetRoot: string,
): Promise<string> {
  const id = randomUUID();
  const request = v.parse(nativeRequestSchema, {
    type: "native-request",
    id,
    epoch,
    method: "asset-root.stage",
    root,
    assetRoot,
  });
  return new Promise((resolve, reject) => {
    nativeCalls.set(id, {
      epoch,
      method: request.method,
      resolve: (value) => resolve(value as string),
      reject,
    });
    parentPort.postMessage(request);
  });
}

function requestAssetRootCommit(epoch: number, stageId: string): Promise<void> {
  return requestAssetRootTransition(epoch, "asset-root.commit", stageId);
}

function requestAssetRootRollback(epoch: number, stageId: string): Promise<void> {
  return requestAssetRootTransition(epoch, "asset-root.rollback", stageId);
}

function requestAssetRootTransition(
  epoch: number,
  method: "asset-root.commit" | "asset-root.rollback",
  stageId: string,
): Promise<void> {
  const id = randomUUID();
  const request = v.parse(nativeRequestSchema, {
    type: "native-request",
    id,
    epoch,
    method,
    stageId,
  });
  return new Promise((resolve, reject) => {
    nativeCalls.set(id, {
      epoch,
      method: request.method,
      resolve: () => resolve(),
      reject,
    });
    parentPort.postMessage(request);
  });
}

function requestExportSave(
  epoch: number,
  windowKind: "main" | "quick-capture",
  preparation: { suggestedName: string; content: string },
): Promise<string | null> {
  const id = randomUUID();
  const request = v.parse(nativeRequestSchema, {
    type: "native-request",
    id,
    epoch,
    method: "export.save",
    windowKind,
    ...preparation,
  });
  return new Promise((resolve, reject) => {
    nativeCalls.set(id, {
      epoch,
      method: request.method,
      resolve: (value) => resolve(value as string | null),
      reject,
    });
    parentPort.postMessage(request);
  });
}

function validateNativeResponse(method: NativeRequest["method"], value: unknown): boolean {
  if (method === "export.save") {
    return v.safeParse(v.nullable(v.pipe(v.string(), v.minLength(1))), value).success;
  }
  if (method === "asset-root.stage") {
    return v.safeParse(v.pipe(v.string(), v.minLength(1)), value).success;
  }
  return value === null;
}

function assertMainWindow(windowKind: "main" | "quick-capture"): asserts windowKind is "main" {
  if (windowKind !== "main") {
    throw new VaultEngineError({
      kind: "INVALID_WINDOW",
      message: "This operation is only available from the main window.",
    });
  }
}

function respond(port: Electron.MessagePortMain, response: EngineResponse): void {
  port.postMessage(v.parse(engineResponseSchema, response));
}

function errorData(error: unknown): DesktopErrorData {
  if (
    error instanceof VaultEngineError ||
    error instanceof CollectionsEngineError ||
    error instanceof CloudEngineError
  ) {
    return { kind: error.kind, message: error.message, details: error.details };
  }
  const message = error instanceof Error ? error.message : String(error);
  return { kind: "IO_ERROR", message };
}
