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
} from "./bridge-contract";
import { VaultEngine, VaultEngineError } from "./vault-engine";

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
    resolve: () => void;
    reject: (error: VaultEngineError) => void;
  }
>();

let connected = false;

parentPort.on("message", (event) => {
  const nativeResponse = v.safeParse(nativeResponseSchema, event.data);
  if (nativeResponse.success) {
    const call = nativeCalls.get(nativeResponse.output.id);
    if (!call || call.epoch !== nativeResponse.output.epoch) return;
    nativeCalls.delete(nativeResponse.output.id);
    if (nativeResponse.output.ok) call.resolve();
    else call.reject(new VaultEngineError(nativeResponse.output.error));
    return;
  }

  if (connected) return;
  const connection = v.safeParse(engineConnectSchema, event.data);
  const port = event.ports[0];
  if (!connection.success || !port) {
    throw new Error("Markd Engine received an invalid renderer channel");
  }
  connected = true;
  const { epoch, configDir } = connection.output;
  const vault = new VaultEngine(configDir, (root, path) => requestTrash(epoch, root, path));

  const becomeReady = () => {
    port.on("message", (messageEvent) => {
      const parsed = v.safeParse(engineRequestSchema, messageEvent.data);
      if (!parsed.success) {
        console.error("[markd-engine] rejected invalid request");
        process.exit(1);
        return;
      }
      void handleRequest(vault, parsed.output)
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
  const delay = Number(process.env.MARKD_ENGINE_READY_DELAY_MS ?? 0);
  if (Number.isFinite(delay) && delay > 0) setTimeout(becomeReady, delay);
  else becomeReady();
});

async function handleRequest(vault: VaultEngine, request: EngineRequest): Promise<unknown> {
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
      await vault.writeNote(request.params.rel, request.params.content);
      return null;
    case "vault.trash":
      return vault.moveToTrash(request.params.rel);
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
    nativeCalls.set(id, { epoch, resolve, reject });
    parentPort.postMessage(request);
  });
}

function respond(port: Electron.MessagePortMain, response: EngineResponse): void {
  port.postMessage(v.parse(engineResponseSchema, response));
}

function errorData(error: unknown): DesktopErrorData {
  if (error instanceof VaultEngineError) {
    return { kind: error.kind, message: error.message, details: error.details };
  }
  const message = error instanceof Error ? error.message : String(error);
  return { kind: "IO_ERROR", message };
}
