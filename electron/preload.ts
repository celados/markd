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

function engineUnavailable(message: string): {
  ok: false;
  error: DesktopErrorData;
} {
  return {
    ok: false,
    error: { kind: "ENGINE_UNAVAILABLE", message },
  };
}

function emitLifecycle(event: EngineState): void {
  const key = `${event.epoch}:${event.state}`;
  if (key === lastLifecycleKey) return;
  lastLifecycleKey = key;
  for (const listener of lifecycleListeners) listener(event);
}

function resolvePendingBefore(epoch: number, message: string): void {
  const result = engineUnavailable(message);
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

function resolveWaitersBefore(epoch: number, message: string): void {
  const result = engineUnavailable(message);
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
  if (currentState && nextState.epoch < currentState.epoch) return;
  if (
    currentState?.epoch === nextState.epoch &&
    (currentState.state === "unavailable" ||
      (currentState.state === "ready" && nextState.state === "starting"))
  ) {
    return;
  }

  if (!currentState || nextState.epoch > currentState.epoch) {
    resolvePendingBefore(nextState.epoch, "Markd Engine restarted.");
    resolveWaitersBefore(nextState.epoch, "Markd Engine restarted.");
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
  applyEngineState({
    state: "unavailable",
    epoch,
    error: engineUnavailable(message).error,
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
        call.resolve(
          engineUnavailable("Markd Engine sent an invalid response value."),
        );
        return;
      }
      call.resolve({ ok: true, value: message.value });
      return;
    }
    call.resolve({ ok: false, error: message.error });
  };

  nextPort.addEventListener("close", () => {
    if (port !== nextPort) return;
    applyEngineState({
      state: "unavailable",
      epoch,
      error: engineUnavailable("Markd Engine is unavailable.").error,
    });
  });
  nextPort.start();
  resolveWaitersAt(epoch, { ok: true, value: { port: nextPort, epoch } });
}

async function readEngineState(): Promise<DesktopResult<EngineState>> {
  const rawState: unknown = await ipcRenderer.invoke("markd:engine-state");
  const state = v.safeParse(engineStateSchema, rawState);
  if (!state.success) {
    if (currentState) {
      applyEngineState({
        state: "unavailable",
        epoch: currentState.epoch,
        error: engineUnavailable("Markd Desktop returned an invalid engine state.")
          .error,
      });
    }
    ipcRenderer.send("markd:engine-channel-error", {
      reason: "invalid-channel",
    });
    return {
      ok: false,
      error: {
        kind: "ENGINE_UNAVAILABLE",
        message: "Markd Desktop returned an invalid engine state.",
      },
    };
  }
  applyEngineState(state.output);
  return { ok: true, value: state.output };
}

async function rejectInvalidChannel(nextPort: MessagePort | undefined): Promise<void> {
  nextPort?.close();
  const state = await readEngineState();
  if (state.ok) {
    applyEngineState({
      state: "unavailable",
      epoch: state.value.epoch,
      error: engineUnavailable("Markd Desktop provided an invalid engine channel.")
        .error,
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
    return Promise.resolve(engineUnavailable("Markd Engine is unavailable."));
  }
  return new Promise((resolve) => {
    portWaiters.add({ epoch, resolve });
  });
}

async function requestEngine(): Promise<DesktopResult<null>> {
  const state = await readEngineState();
  if (!state.ok) return state;
  if (state.value.state === "unavailable") {
    return { ok: false, error: state.value.error };
  }

  const outcome = await waitForPort(state.value.epoch);
  if (!outcome.ok) return outcome;
  const request = v.parse(engineRequestSchema, {
    type: "request",
    id: crypto.randomUUID(),
    method: "vault.startup",
    params: null,
  });
  return new Promise((resolve) => {
    pending.set(request.id, {
      epoch: outcome.value.epoch,
      method: request.method,
      resolve: resolve as (result: DesktopResult<unknown>) => void,
    });
    outcome.value.port.postMessage(request);
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
    onEngineLifecycle: (listener: (event: EngineState) => void) => {
      lifecycleListeners.add(listener);
      if (currentState) queueMicrotask(() => listener(currentState!));
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
