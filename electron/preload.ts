import { contextBridge, ipcRenderer } from "electron";
import * as v from "valibot";
import {
  controlRequestSchema,
  controlResponseSchema,
  engineMessageSchema,
  enginePortMetadataSchema,
  engineRequestSchema,
  validateResponseValue,
  type ControlRequest,
  type DesktopErrorData,
  type EngineRequest,
} from "./bridge-contract";

type DesktopResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: DesktopErrorData };

type EngineLifecycle =
  | { state: "starting"; epoch: number }
  | { state: "ready"; epoch: number }
  | { state: "unavailable"; epoch: number; error: DesktopErrorData };

type PendingCall = {
  epoch: number;
  method: EngineRequest["method"];
  resolve: (result: DesktopResult<unknown>) => void;
};

let port: MessagePort | null = null;
let activeEpoch = 0;
let resolvePort: ((value: MessagePort) => void) | null = null;
let portReady = createPortPromise();
const pending = new Map<string, PendingCall>();
const lifecycleListeners = new Set<(event: EngineLifecycle) => void>();

function createPortPromise(): Promise<MessagePort> {
  return new Promise((resolve) => {
    resolvePort = resolve;
  });
}

function engineUnavailable(message: string): {
  ok: false;
  error: DesktopErrorData;
} {
  return {
    ok: false,
    error: { kind: "ENGINE_UNAVAILABLE", message },
  };
}

function emitLifecycle(event: EngineLifecycle): void {
  for (const listener of lifecycleListeners) listener(event);
}

function resolvePending(result: DesktopResult<never>): void {
  for (const call of pending.values()) call.resolve(result);
  pending.clear();
}

function invalidateGeneration(nextPort: MessagePort, message: string): void {
  if (port !== nextPort) return;
  const epoch = activeEpoch;
  port = null;
  nextPort.close();
  const result = engineUnavailable(message);
  resolvePending(result);
  emitLifecycle({
    state: "unavailable",
    epoch,
    error: result.error,
  });
  portReady = createPortPromise();
  ipcRenderer.send("markd:engine-protocol-error", { epoch });
}

function attachPort(nextPort: MessagePort, epoch: number): void {
  port?.close();
  resolvePending(
    engineUnavailable("Markd Engine restarted before the operation completed."),
  );
  port = nextPort;
  activeEpoch = epoch;
  emitLifecycle({ state: "starting", epoch });

  nextPort.onmessage = (event) => {
    const parsed = v.safeParse(engineMessageSchema, event.data);
    if (!parsed.success || parsed.output.epoch !== activeEpoch) {
      invalidateGeneration(nextPort, "Markd Engine sent an invalid response.");
      return;
    }

    const message = parsed.output;
    if (message.type === "ready") {
      emitLifecycle({ state: "ready", epoch });
      ipcRenderer.send("markd:engine-ready", { epoch });
      return;
    }

    const call = pending.get(message.id);
    if (!call || call.epoch !== message.epoch) return;
    pending.delete(message.id);
    if (message.ok) {
      if (!validateResponseValue(call.method, message.value)) {
        invalidateGeneration(nextPort, "Markd Engine sent an invalid response value.");
        call.resolve(engineUnavailable("Markd Engine sent an invalid response value."));
        return;
      }
      call.resolve({ ok: true, value: message.value });
      return;
    }
    call.resolve({ ok: false, error: message.error });
  };

  nextPort.addEventListener("close", () => {
    if (port !== nextPort) return;
    const epoch = activeEpoch;
    port = null;
    const result = engineUnavailable("Markd Engine is unavailable.");
    resolvePending(result);
    emitLifecycle({ state: "unavailable", epoch, error: result.error });
    portReady = createPortPromise();
  });
  nextPort.start();
  resolvePort?.(nextPort);
  resolvePort = null;
}

ipcRenderer.on("markd:engine-port", (event, data: unknown) => {
  const metadata = v.safeParse(enginePortMetadataSchema, data);
  const nextPort = event.ports[0];
  if (!metadata.success || !nextPort) {
    console.error("[markd-preload] rejected invalid engine channel metadata");
    return;
  }
  attachPort(nextPort, metadata.output.epoch);
});

async function requestEngine(): Promise<DesktopResult<null>> {
  const activePort = port ?? (await portReady);
  const request = v.parse(engineRequestSchema, {
    type: "request",
    id: crypto.randomUUID(),
    method: "vault.startup",
    params: null,
  });
  return new Promise((resolve) => {
    pending.set(request.id, {
      epoch: activeEpoch,
      method: request.method,
      resolve: resolve as (result: DesktopResult<unknown>) => void,
    });
    activePort.postMessage(request);
  });
}

async function requestControl(
  requestInput: unknown,
): Promise<DesktopResult<null>> {
  const parsedRequest = v.safeParse(controlRequestSchema, requestInput);
  if (!parsedRequest.success) {
    return {
      ok: false,
      error: {
        kind: "INVALID_REQUEST",
        message: "Markd Desktop rejected an invalid request.",
      },
    };
  }
  const request = parsedRequest.output;
  const rawResponse: unknown = await ipcRenderer.invoke("markd:control", request);
  const response = v.safeParse(controlResponseSchema, rawResponse);
  if (
    !response.success ||
    response.output.id !== request.id
  ) {
    return {
      ok: false,
      error: {
        kind: "INVALID_RESPONSE",
        message: "Markd Desktop returned an invalid response.",
      },
    };
  }
  if (!response.output.ok) {
    return { ok: false, error: response.output.error };
  }
  if (!validateResponseValue(request.method, response.output.value)) {
    return {
      ok: false,
      error: {
        kind: "INVALID_RESPONSE",
        message: "Markd Desktop returned an invalid response value.",
      },
    };
  }
  return { ok: true, value: null };
}

function controlRequestInput(
  method: ControlRequest["method"],
  params: null | { id: string },
): unknown {
  return {
    type: "request",
    id: crypto.randomUUID(),
    method,
    params,
  };
}

contextBridge.exposeInMainWorld("markd", {
  app: {
    windowKind: "main",
    onNotesChanged: () => () => {},
    onEngineLifecycle: (listener: (event: EngineLifecycle) => void) => {
      lifecycleListeners.add(listener);
      return () => lifecycleListeners.delete(listener);
    },
  },
  vault: {
    startup: requestEngine,
  },
  updates: {
    check: () => requestControl(controlRequestInput("updates.check", null)),
    install: (id: string) =>
      requestControl(controlRequestInput("updates.install", { id })),
    relaunch: () => requestControl(controlRequestInput("app.relaunch", null)),
  },
});
