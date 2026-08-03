import {
  app,
  BrowserWindow,
  ipcMain,
  MessageChannelMain,
  protocol,
  utilityProcess,
  type UtilityProcess,
  type WebContents,
} from "electron";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as v from "valibot";
import {
  controlRequestSchema,
  controlResponseSchema,
  engineChannelFailureSchema,
  engineControlSchema,
  engineStateSchema,
  type ControlResponse,
  type DesktopErrorData,
  type EngineState,
} from "./bridge-contract";
import { createEngineGenerationTerminal } from "./engine-generation";

const moduleDir = dirname(fileURLToPath(import.meta.url));
const development =
  Boolean(process.env.VITE_DEV_SERVER_URL) ||
  process.env.MARKD_ENABLE_DEVTOOLS === "1";
let engine: UtilityProcess | null = null;
let mainWindow: BrowserWindow | null = null;
let engineEpoch = 0;
let restartAvailable = true;
let engineState: EngineState | null = null;

protocol.registerSchemesAsPrivileged([
  {
    scheme: "markd-asset",
    privileges: { secure: true, standard: true, supportFetchAPI: true },
  },
]);

function attachWindowDiagnostics(webContents: WebContents): void {
  webContents.on("render-process-gone", (_event, details) => {
    console.error("[markd-renderer] process gone", details);
  });
  webContents.on("unresponsive", () => {
    console.error("[markd-renderer] unresponsive");
  });
  if (development) {
    webContents.on("console-message", (details) => {
      const write =
        details.level === "error" || details.level === "warning"
          ? console.error
          : console.log;
      write(`[markd-renderer] ${details.message}`);
    });
    webContents.on("before-input-event", (event, input) => {
      if (input.type !== "keyDown") return;
      const accelerator =
        input.key === "F12" ||
        (process.platform === "darwin"
          ? input.meta && input.alt && input.key.toLowerCase() === "i"
          : input.control && input.shift && input.key.toLowerCase() === "i");
      if (!accelerator) return;
      event.preventDefault();
      webContents.toggleDevTools();
    });
  }
}

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 840,
    minHeight: 560,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      preload: join(moduleDir, "preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  attachWindowDiagnostics(window.webContents);
  if (process.env.VITE_DEV_SERVER_URL) {
    void window.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    void window.loadFile(join(moduleDir, "../dist/index.html"));
  }
  return window;
}

function publishEngineState(state: EngineState): void {
  engineState = v.parse(engineStateSchema, state);
  const window = mainWindow;
  if (window && !window.isDestroyed()) {
    window.webContents.send("markd:engine-state", engineState);
  }
}

function unavailableError(message: string): DesktopErrorData {
  return { kind: "ENGINE_UNAVAILABLE", message };
}

function connectEngine(window: BrowserWindow): UtilityProcess {
  const epoch = ++engineEpoch;
  publishEngineState({ state: "starting", epoch });
  const child = utilityProcess.fork(join(moduleDir, "engine.js"), [], {
    serviceName: "Markd Engine",
    stdio: "pipe",
    env: {
      ...process.env,
      MARKD_ENGINE_TEST_ABORT_DELAY_MS:
        process.env.MARKD_TEST_ABORT_ENGINE_EPOCH === String(epoch)
          ? process.env.MARKD_TEST_ABORT_DELAY_MS ?? "500"
          : "",
    },
  });
  const { port1, port2 } = new MessageChannelMain();
  let childReady = false;
  let rendererReady = !window.webContents.isLoadingMainFrame();
  let transferred = false;
  let transferTimer: ReturnType<typeof setTimeout> | null = null;
  const terminal = createEngineGenerationTerminal((message) => {
    if (transferTimer) clearTimeout(transferTimer);
    publishEngineState({
      state: "unavailable",
      epoch,
      error: unavailableError(message),
    });
    if (engine === child) engine = null;
    if (mainWindow !== window || window.isDestroyed() || !restartAvailable) return;
    restartAvailable = false;
    console.log(`[markd-main] restarting engine after epoch=${epoch}`);
    engine = connectEngine(window);
  });

  const performTransfer = () => {
    transferTimer = null;
    if (
      transferred ||
      terminal.isTerminal() ||
      !childReady ||
      !rendererReady ||
      window.isDestroyed()
    ) {
      return;
    }
    transferred = true;
    child.postMessage({ type: "connect", epoch }, [port1]);
    window.webContents.postMessage("markd:engine-port", { epoch }, [port2]);
  };
  const transfer = () => {
    if (!childReady || !rendererReady || transferred || terminal.isTerminal()) return;
    const delay = Number(process.env.MARKD_TEST_ENGINE_TRANSFER_DELAY_MS ?? 0);
    if (Number.isFinite(delay) && delay > 0) {
      if (!transferTimer) transferTimer = setTimeout(performTransfer, delay);
      return;
    }
    performTransfer();
  };
  child.once("spawn", () => {
    childReady = true;
    console.log(`[markd-main] engine spawned epoch=${epoch} pid=${child.pid}`);
    transfer();
  });
  if (!rendererReady) {
    window.webContents.once("did-finish-load", () => {
      rendererReady = true;
      transfer();
    });
  }
  child.on("exit", (code) => {
    console.error(`[markd-main] engine exited epoch=${epoch} code=${code}`);
    terminal.terminate("Markd Engine exited unexpectedly.");
  });
  child.on("error", (type, location, report) => {
    console.error("[markd-main] engine fatal error", {
      epoch,
      type,
      location,
      report,
    });
    terminal.terminate("Markd Engine encountered a fatal error.");
    child.kill();
  });
  child.stdout?.pipe(process.stdout);
  child.stderr?.pipe(process.stderr);
  return child;
}

function acceptEngineControl(
  event: Electron.IpcMainEvent,
  input: unknown,
): number | null {
  const control = v.safeParse(engineControlSchema, input);
  if (
    !control.success ||
    event.sender !== mainWindow?.webContents ||
    control.output.epoch !== engineEpoch
  ) {
    return null;
  }
  return control.output.epoch;
}

ipcMain.handle("markd:control", (event, input: unknown): ControlResponse => {
  const request = v.safeParse(controlRequestSchema, input);
  if (!request.success || event.sender !== mainWindow?.webContents) {
    return v.parse(controlResponseSchema, {
      type: "response",
      id: "invalid-request",
      ok: false,
      error: {
        kind: "INVALID_REQUEST",
        message: "Markd Desktop rejected an invalid request.",
      },
    });
  }

  const { id, method } = request.output;
  if (method === "updates.install") {
    return v.parse(controlResponseSchema, {
      type: "response",
      id,
      ok: false,
      error: {
        kind: "NOT_AVAILABLE",
        message: "No update is ready to install.",
      },
    });
  }
  if (method === "app.relaunch") {
    setImmediate(() => {
      app.relaunch();
      app.exit(0);
    });
  }
  return v.parse(controlResponseSchema, {
    type: "response",
    id,
    ok: true,
    value: null,
  });
});

ipcMain.handle("markd:engine-state", (event): EngineState => {
  if (event.sender !== mainWindow?.webContents || !engineState) {
    throw new Error("Markd Desktop rejected an invalid engine state request.");
  }
  return v.parse(engineStateSchema, engineState);
});

ipcMain.on("markd:engine-ready", (event, input: unknown) => {
  const epoch = acceptEngineControl(event, input);
  if (epoch === null) return;
  restartAvailable = true;
  publishEngineState({ state: "ready", epoch });
  console.log(`[markd-main] engine ready epoch=${epoch}`);
});

ipcMain.on("markd:engine-protocol-error", (event, input: unknown) => {
  const epoch = acceptEngineControl(event, input);
  if (epoch === null) return;
  console.error(`[markd-main] engine protocol failure epoch=${epoch}`);
  engine?.kill();
});

ipcMain.on("markd:engine-channel-error", (event, input: unknown) => {
  const failure = v.safeParse(engineChannelFailureSchema, input);
  if (!failure.success || event.sender !== mainWindow?.webContents) return;
  console.error(`[markd-main] invalid engine channel epoch=${engineEpoch}`);
  engine?.kill();
});

app.whenReady().then(() => {
  console.log("[markd-main] app ready");
  mainWindow = createMainWindow();
  engine = connectEngine(mainWindow);
  mainWindow.on("closed", () => {
    mainWindow = null;
    engine?.kill();
    engine = null;
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length > 0) return;
    mainWindow = createMainWindow();
    engine = connectEngine(mainWindow);
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
