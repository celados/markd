import { contextBridge, ipcRenderer } from "electron";
import * as v from "valibot";
import {
  controlRequestSchema,
  controlResponseSchema,
  engineMessageSchema,
  enginePortMetadataSchema,
  engineRequestSchema,
  engineStateSchema,
  validateResponseValue,
  type ControlRequest,
  type DesktopErrorData,
  type EngineRequest,
  type EngineState,
} from "./bridge-contract";

type DesktopResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: DesktopErrorData };

type PendingCall = {
  epoch: number;
  method: EngineRequest["method"];
  resolve: (result: DesktopResult<unknown>) => void;
};

type PortOutcome = DesktopResult<{ port: MessagePort; epoch: number }>;

type PortWaiter = {
  epoch: number;
  resolve: (outcome: PortOutcome) => void;
};

let port: MessagePort | null = null;
let activeEpoch = 0;
let currentState: EngineState | null = null;
let lastLifecycleKey = "";
const pending = new Map<string, PendingCall>();
const portWaiters = new Set<PortWaiter>();
const lifecycleListeners = new Set<(event: EngineState) => void>();
const engineUnavailableMessage = "Markd Engine is unavailable.";

function engineUnavailable(): {
  ok: false;
  error: DesktopErrorData;
} {
  return {
    ok: false,
    error: { kind: "ENGINE_UNAVAILABLE", message: engineUnavailableMessage },
  };
}

function publicEngineError(error: DesktopErrorData): DesktopErrorData {
  return error.kind === "ENGINE_UNAVAILABLE" ? engineUnavailable().error : error;
}

function publicEngineState(state: EngineState): EngineState {
  return state.state === "unavailable"
    ? { ...state, error: publicEngineError(state.error) }
    : state;
}

function emitLifecycle(event: EngineState): void {
  const key = `${event.epoch}:${event.state}`;
  if (key === lastLifecycleKey) return;
  lastLifecycleKey = key;
  for (const listener of lifecycleListeners) listener(event);
}

function resolvePendingBefore(epoch: number): void {
  const result = engineUnavailable();
  for (const [id, call] of pending) {
    if (call.epoch >= epoch) continue;
    pending.delete(id);
    call.resolve(result);
  }
}

function resolvePendingAt(epoch: number, result: DesktopResult<never>): void {
  for (const [id, call] of pending) {
    if (call.epoch !== epoch) continue;
    pending.delete(id);
    call.resolve(result);
  }
}

function resolveWaitersBefore(epoch: number): void {
  const result = engineUnavailable();
  for (const waiter of portWaiters) {
    if (waiter.epoch >= epoch) continue;
    portWaiters.delete(waiter);
    waiter.resolve(result);
  }
}

function resolveWaitersAt(epoch: number, outcome: PortOutcome): void {
  for (const waiter of portWaiters) {
    if (waiter.epoch !== epoch) continue;
    portWaiters.delete(waiter);
    waiter.resolve(outcome);
  }
}

function applyEngineState(nextState: EngineState): void {
  // Main keeps the concrete failure for diagnostics; renderer behavior must not
  // depend on whether an exit, fatal error, or port close won the race.
  nextState = publicEngineState(nextState);
  if (currentState && nextState.epoch < currentState.epoch) return;
  if (
    currentState?.epoch === nextState.epoch &&
    (currentState.state === "unavailable" ||
      (currentState.state === "ready" && nextState.state === "starting"))
  ) {
    return;
  }

  if (!currentState || nextState.epoch > currentState.epoch) {
    resolvePendingBefore(nextState.epoch);
    resolveWaitersBefore(nextState.epoch);
    if (port && activeEpoch < nextState.epoch) {
      const oldPort = port;
      port = null;
      oldPort.close();
    }
  }

  currentState = nextState;
  if (nextState.state === "unavailable") {
    if (port && activeEpoch === nextState.epoch) {
      const failedPort = port;
      port = null;
      failedPort.close();
    }
    const result: DesktopResult<never> = {
      ok: false,
      error: nextState.error,
    };
    resolvePendingAt(nextState.epoch, result);
    resolveWaitersAt(nextState.epoch, result);
  }
  emitLifecycle(nextState);
}

function invalidateGeneration(nextPort: MessagePort, message: string): void {
  if (port !== nextPort) return;
  const epoch = activeEpoch;
  console.error("[markd-preload] invalid engine generation", { epoch, message });
  applyEngineState({
    state: "unavailable",
    epoch,
    error: engineUnavailable().error,
  });
  ipcRenderer.send("markd:engine-protocol-error", { epoch });
}

function attachPort(nextPort: MessagePort, epoch: number): void {
  if (
    currentState &&
    (currentState.epoch > epoch ||
      (currentState.epoch === epoch && currentState.state === "unavailable"))
  ) {
    nextPort.close();
    return;
  }

  if (port && port !== nextPort) port.close();
  port = nextPort;
  activeEpoch = epoch;
  if (!currentState || currentState.epoch < epoch) {
    applyEngineState({ state: "starting", epoch });
  }

  nextPort.onmessage = (event) => {
    const parsed = v.safeParse(engineMessageSchema, event.data);
    if (!parsed.success || parsed.output.epoch !== activeEpoch) {
      invalidateGeneration(nextPort, "Markd Engine sent an invalid response.");
      return;
    }

    const message = parsed.output;
    if (message.type === "ready") {
      applyEngineState({ state: "ready", epoch });
      ipcRenderer.send("markd:engine-ready", { epoch });
      return;
    }

    const call = pending.get(message.id);
    if (!call || call.epoch !== message.epoch) return;
    pending.delete(message.id);
    if (message.ok) {
      if (!validateResponseValue(call.method, message.value)) {
        invalidateGeneration(nextPort, "Markd Engine sent an invalid response value.");
        call.resolve(engineUnavailable());
        return;
      }
      call.resolve({ ok: true, value: message.value });
      return;
    }
    call.resolve({ ok: false, error: publicEngineError(message.error) });
  };

  nextPort.addEventListener("close", () => {
    if (port !== nextPort) return;
    applyEngineState({
      state: "unavailable",
      epoch,
      error: engineUnavailable().error,
    });
  });
  nextPort.start();
  resolveWaitersAt(epoch, { ok: true, value: { port: nextPort, epoch } });
}

async function readEngineState(): Promise<DesktopResult<EngineState>> {
  const rawState: unknown = await ipcRenderer.invoke("markd:engine-state");
  const state = v.safeParse(engineStateSchema, rawState);
  if (!state.success) {
    console.error("[markd-preload] invalid engine state", rawState);
    if (currentState) {
      applyEngineState({
        state: "unavailable",
        epoch: currentState.epoch,
        error: engineUnavailable().error,
      });
    }
    ipcRenderer.send("markd:engine-channel-error", {
      reason: "invalid-channel",
    });
    return engineUnavailable();
  }
  const nextState = publicEngineState(state.output);
  applyEngineState(nextState);
  return { ok: true, value: currentState ?? nextState };
}

async function rejectInvalidChannel(nextPort: MessagePort | undefined): Promise<void> {
  nextPort?.close();
  const state = await readEngineState();
  if (state.ok) {
    console.error("[markd-preload] invalid engine channel", {
      epoch: state.value.epoch,
    });
    applyEngineState({
      state: "unavailable",
      epoch: state.value.epoch,
      error: engineUnavailable().error,
    });
  }
  ipcRenderer.send("markd:engine-channel-error", {
    reason: "invalid-channel",
  });
}

ipcRenderer.on("markd:engine-state", (_event, input: unknown) => {
  const state = v.safeParse(engineStateSchema, input);
  if (!state.success) {
    void rejectInvalidChannel(undefined);
    return;
  }
  applyEngineState(state.output);
});

ipcRenderer.on("markd:engine-port", (event, data: unknown) => {
  const metadata = v.safeParse(enginePortMetadataSchema, data);
  const nextPort = event.ports[0];
  if (!metadata.success || !nextPort) {
    void rejectInvalidChannel(nextPort);
    return;
  }
  attachPort(nextPort, metadata.output.epoch);
});

function waitForPort(epoch: number): Promise<PortOutcome> {
  if (port && activeEpoch === epoch) {
    return Promise.resolve({ ok: true, value: { port, epoch } });
  }
  if (
    currentState &&
    (currentState.epoch > epoch ||
      (currentState.epoch === epoch && currentState.state === "unavailable"))
  ) {
    return Promise.resolve(engineUnavailable());
  }
  return new Promise((resolve) => {
    portWaiters.add({ epoch, resolve });
  });
}

async function requestEngine<T>(
  method: EngineRequest["method"],
  params: unknown,
): Promise<DesktopResult<T>> {
  const state = await readEngineState();
  if (!state.ok) return state;
  if (state.value.state === "unavailable") {
    return { ok: false, error: state.value.error };
  }

  const outcome = await waitForPort(state.value.epoch);
  if (!outcome.ok) return outcome;
  const parsedRequest = v.safeParse(engineRequestSchema, {
    type: "request",
    id: crypto.randomUUID(),
    method,
    params,
  });
  if (!parsedRequest.success) {
    return {
      ok: false,
      error: { kind: "INVALID_REQUEST", message: "Markd Desktop rejected an invalid request." },
    };
  }
  const request = parsedRequest.output;
  return new Promise((resolve) => {
    pending.set(request.id, {
      epoch: outcome.value.epoch,
      method: request.method,
      resolve: resolve as (result: DesktopResult<unknown>) => void,
    });
    outcome.value.port.postMessage(request);
  });
}

async function requestControl<T>(
  requestInput: unknown,
): Promise<DesktopResult<T>> {
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
  let rawResponse: unknown;
  try {
    rawResponse = await ipcRenderer.invoke("markd:control", request);
  } catch (error) {
    return {
      ok: false,
      error: {
        kind: "NATIVE_OPERATION_FAILED",
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
  const response = v.safeParse(controlResponseSchema, rawResponse);
  if (!response.success || response.output.id !== request.id) {
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
  return { ok: true, value: response.output.value as T };
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

async function openFromDialog(create: boolean): Promise<DesktopResult<unknown>> {
  const selection = await requestControl<string | null>(
    controlRequestInput(create ? "dialog.createVault" : "dialog.chooseVault", null),
  );
  if (!selection.ok || selection.value === null) return selection;
  return requestEngine("vault.open", { root: selection.value, create });
}

contextBridge.exposeInMainWorld("markd", {
  app: {
    windowKind: "main",
    onNotesChanged: () => () => {},
    onEngineLifecycle: (listener: (event: EngineState) => void) => {
      lifecycleListeners.add(listener);
      if (currentState) queueMicrotask(() => listener(currentState!));
      return () => lifecycleListeners.delete(listener);
    },
  },
  vault: {
    startup: () => requestEngine("vault.startup", null),
    choose: () => openFromDialog(false),
    create: () => openFromDialog(true),
    snapshot: () => requestEngine("vault.snapshot", null),
    createNote: (dir: string, title: string, content = "") =>
      requestEngine("vault.note.create", { dir, title, content }),
    readNote: (rel: string) => requestEngine("vault.note.read", { rel }),
    writeNote: (rel: string, content: string) =>
      requestEngine("vault.note.write", { rel, content }),
    moveToTrash: (rel: string) => requestEngine("vault.trash", { rel }),
  },
  updates: {
    check: () => requestControl(controlRequestInput("updates.check", null)),
    install: (id: string) =>
      requestControl(controlRequestInput("updates.install", { id })),
    relaunch: () => requestControl(controlRequestInput("app.relaunch", null)),
  },
});
