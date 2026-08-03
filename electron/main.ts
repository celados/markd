import {
  app,
  BrowserWindow,
  dialog,
  globalShortcut,
  ipcMain,
  MessageChannelMain,
  protocol,
  screen,
  shell,
  utilityProcess,
  type UtilityProcess,
  type WebContents,
} from "electron";
import { realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import * as v from "valibot";
import {
  controlRequestSchema,
  controlResponseSchema,
  engineChannelFailureSchema,
  engineControlSchema,
  engineStateSchema,
  nativeRequestSchema,
  nativeResponseSchema,
  type ControlResponse,
  type DesktopErrorData,
  type EngineState,
  windowKindSchema,
  type NativeRequest,
} from "./bridge-contract";
import { createEngineGenerationTerminal } from "./engine-generation";
import { loadAssetResponse, NativeContentError, writeExportFile } from "./native-content";

const moduleDir = dirname(fileURLToPath(import.meta.url));
const development =
  Boolean(process.env.VITE_DEV_SERVER_URL) ||
  process.env.MARKD_ENABLE_DEVTOOLS === "1";
const backgroundE2e = process.env.MARKD_E2E_BACKGROUND === "1";

if (backgroundE2e && process.platform === "darwin") {
  // Smoke tests need the real app process without activating a Dock app in the
  // user's session. Foreground behavior remains the production default.
  app.setActivationPolicy("prohibited");
}
let engine: UtilityProcess | null = null;
let mainWindow: BrowserWindow | null = null;
let captureWindow: BrowserWindow | null = null;
let engineEpoch = 0;
let restartAvailable = true;
let engineState: EngineState | null = null;
let engineSpawned = false;
let quitting = false;
const attachedWebContents = new Set<number>();
const loadedWebContents = new Set<number>();
const windowKinds = new Map<number, v.InferOutput<typeof windowKindSchema>>();
const captureAccelerator =
  process.env.MARKD_TEST_QUICK_CAPTURE_ACCELERATOR ?? "Control+Shift+Space";

if (process.platform === "linux") {
  // Wayland exposes global accelerators through the desktop portal rather than
  // X11 grabs. Electron requires this feature switch before app readiness.
  app.commandLine.appendSwitch("enable-features", "GlobalShortcutsPortal");
}
let activeAssetRoot: string | null = null;

protocol.registerSchemesAsPrivileged([
  {
    scheme: "markd-asset",
    privileges: {
      secure: true,
      standard: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
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
    show: !backgroundE2e,
    focusable: !backgroundE2e,
    skipTaskbar: backgroundE2e,
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
  wireRendererWindow(window, "main");
  return window;
}

function createCaptureWindow(): BrowserWindow {
  const window = new BrowserWindow({
    show: false,
    focusable: !backgroundE2e,
    skipTaskbar: true,
    width: 500,
    height: 356,
    minWidth: 500,
    minHeight: 356,
    maxWidth: 500,
    maxHeight: 356,
    resizable: false,
    maximizable: false,
    minimizable: false,
    frame: false,
    alwaysOnTop: true,
    webPreferences: {
      preload: join(moduleDir, "preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  attachWindowDiagnostics(window.webContents);
  wireRendererWindow(window, "quick-capture");
  window.on("close", (event) => {
    if (quitting) return;
    event.preventDefault();
    window.hide();
  });
  return window;
}

function wireRendererWindow(
  window: BrowserWindow,
  kind: v.InferOutput<typeof windowKindSchema>,
): void {
  windowKinds.set(window.webContents.id, kind);
  window.webContents.on("did-start-loading", () => {
    attachedWebContents.delete(window.webContents.id);
    loadedWebContents.delete(window.webContents.id);
  });
  window.webContents.on("did-finish-load", () => {
    loadedWebContents.add(window.webContents.id);
    attachRendererToEngine(window);
  });
  window.webContents.on("destroyed", () => {
    attachedWebContents.delete(window.webContents.id);
    loadedWebContents.delete(window.webContents.id);
    windowKinds.delete(window.webContents.id);
  });
  if (process.env.VITE_DEV_SERVER_URL) {
    void window.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    void window.loadFile(join(moduleDir, "../dist/index.html"));
  }
}

function markdWindows(): BrowserWindow[] {
  return [mainWindow, captureWindow].filter(
    (window): window is BrowserWindow => Boolean(window && !window.isDestroyed()),
  );
}

function publishEngineState(state: EngineState): void {
  engineState = v.parse(engineStateSchema, state);
  for (const window of markdWindows()) {
    window.webContents.send("markd:engine-state", engineState);
  }
}

function unavailableError(message: string): DesktopErrorData {
  return { kind: "ENGINE_UNAVAILABLE", message };
}

function connectEngine(): UtilityProcess {
  const epoch = ++engineEpoch;
  engineSpawned = false;
  attachedWebContents.clear();
  // A replacement utility must explicitly re-authorize its Vault before the
  // protocol can expose files from the previous generation.
  activeAssetRoot = null;
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
  const terminal = createEngineGenerationTerminal((message) => {
    publishEngineState({
      state: "unavailable",
      epoch,
      error: unavailableError(message),
    });
    if (engine === child) engine = null;
    if (quitting || !restartAvailable || markdWindows().length === 0) return;
    restartAvailable = false;
    console.log(`[markd-main] restarting engine after epoch=${epoch}`);
    engine = connectEngine();
  });
  child.once("spawn", () => {
    engineSpawned = true;
    console.log(`[markd-main] engine spawned epoch=${epoch} pid=${child.pid}`);
    for (const window of markdWindows()) attachRendererToEngine(window);
  });
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
  child.on("message", (input: unknown) => {
    const request = v.safeParse(nativeRequestSchema, input);
    if (!request.success || request.output.epoch !== epoch) return;
    void performNativeRequest(request.output)
      .then((value) => child.postMessage(v.parse(nativeResponseSchema, {
        type: "native-response",
        id: request.output.id,
        epoch,
        ok: true,
        value,
      })))
      .catch((error: unknown) => child.postMessage(v.parse(nativeResponseSchema, {
        type: "native-response",
        id: request.output.id,
        epoch,
        ok: false,
        error: {
          kind:
            error instanceof NativeContentError
              ? error.kind
              : "NATIVE_OPERATION_FAILED",
          message: error instanceof Error ? error.message : String(error),
        },
      })));
  });
  child.stdout?.pipe(process.stdout);
  child.stderr?.pipe(process.stderr);
  return child;
}

function attachRendererToEngine(window: BrowserWindow): void {
  const child = engine;
  const webContents = window.webContents;
  if (
    !child ||
    !engineSpawned ||
    !loadedWebContents.has(webContents.id) ||
    attachedWebContents.has(webContents.id) ||
    window.isDestroyed()
  ) {
    return;
  }
  attachedWebContents.add(webContents.id);
  const { port1, port2 } = new MessageChannelMain();
  const transfer = () => {
    if (engine !== child || window.isDestroyed()) {
      port1.close();
      port2.close();
      return;
    }
    child.postMessage({
      type: "connect",
      epoch: engineEpoch,
      configDir: process.env.MARKD_TEST_CONFIG_DIR ?? app.getPath("userData"),
    }, [port1]);
    webContents.postMessage("markd:engine-port", { epoch: engineEpoch }, [port2]);
  };
  const delay = Number(process.env.MARKD_TEST_ENGINE_TRANSFER_DELAY_MS ?? 0);
  if (Number.isFinite(delay) && delay > 0) setTimeout(transfer, delay);
  else transfer();
}

async function performNativeRequest(
  request: NativeRequest,
): Promise<unknown> {
  if (request.method === "asset-root.activate") {
    activeAssetRoot = await validateAssetRoot(request.root, request.assetRoot);
    return null;
  }
  if (request.method === "export.save") {
    if (process.env.MARKD_TEST_EXPORT_FAILURE === "1") {
      throw new Error("The operating system rejected the export operation.");
    }
    const result = await dialog.showSaveDialog(mainWindow!, {
      title: "Export Markdown",
      defaultPath: request.suggestedName,
      buttonLabel: "Export",
    });
    if (result.canceled || !result.filePath) return null;
    return writeExportFile(result.filePath, request.content);
  }
  if (process.env.MARKD_TEST_TRASH_FAILURE === "1") {
    throw new Error("The operating system rejected the Trash operation.");
  }
  const [root, path] = await Promise.all([
    realpath(request.root),
    realpath(request.path),
  ]);
  const offset = relative(root, path);
  if (
    offset === "" ||
    offset === ".." ||
    offset.startsWith(`..${sep}`) ||
    isAbsolute(offset)
  ) {
    throw new Error("Markd Desktop rejected a Trash target outside the Vault.");
  }
  await shell.trashItem(path);
  return null;
}

async function validateAssetRoot(root: string, assetRoot: string): Promise<string> {
  const [canonicalRoot, canonicalAssetRoot] = await Promise.all([
    realpath(root),
    realpath(assetRoot),
  ]);
  if (
    normalize(root) !== normalize(canonicalRoot) ||
    normalize(assetRoot) !== normalize(canonicalAssetRoot) ||
    normalize(canonicalAssetRoot) !== normalize(join(canonicalRoot, ".markd", "assets"))
  ) {
    throw new NativeContentError(
      "INVALID_PATH",
      "Markd Desktop rejected an invalid Vault asset root.",
    );
  }
  const offset = relative(canonicalRoot, canonicalAssetRoot);
  if (!offset || offset === ".." || offset.startsWith(`..${sep}`) || isAbsolute(offset)) {
    throw new NativeContentError(
      "INVALID_PATH",
      "Markd Desktop rejected an asset root outside the Vault.",
    );
  }
  return canonicalAssetRoot;
}

async function handleAssetRequest(request: Request): Promise<Response> {
  if (!activeAssetRoot) return new Response("Asset Vault unavailable", { status: 404 });
  try {
    return await loadAssetResponse(activeAssetRoot, request.url);
  } catch (error) {
    const status =
      error instanceof NativeContentError && error.kind === "NOT_FOUND" ? 404 : 400;
    return new Response("Asset request rejected", {
      status,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
}

function acceptEngineControl(
  event: Electron.IpcMainEvent,
  input: unknown,
): number | null {
  const control = v.safeParse(engineControlSchema, input);
  if (
    !control.success ||
    !windowKinds.has(event.sender.id) ||
    control.output.epoch !== engineEpoch
  ) {
    return null;
  }
  return control.output.epoch;
}

function senderKind(event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) {
  return windowKinds.get(event.sender.id) ?? null;
}

function showQuickCapture(): void {
  const window = captureWindow;
  if (!window || window.isDestroyed()) {
    captureWindow = createCaptureWindow();
    captureWindow.webContents.once("did-finish-load", showQuickCapture);
    return;
  }
  if (!loadedWebContents.has(window.webContents.id)) {
    window.webContents.once("did-finish-load", showQuickCapture);
    return;
  }
  window.webContents.send("markd:capture-open");
  if (backgroundE2e) return;
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const bounds = window.getBounds();
  window.setPosition(
    Math.round(display.workArea.x + (display.workArea.width - bounds.width) / 2),
    Math.round(display.workArea.y + (display.workArea.height - bounds.height) * 0.4),
  );
  window.show();
  window.focus();
}

function closeQuickCapture(): void {
  const window = captureWindow;
  if (!window || window.isDestroyed()) return;
  window.hide();
}

ipcMain.handle("markd:control", async (event, input: unknown): Promise<ControlResponse> => {
  const request = v.safeParse(controlRequestSchema, input);
  const kind = senderKind(event);
  if (!request.success || !kind) {
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
  if (method === "dialog.chooseVault") {
    if (kind !== "main" || !mainWindow) {
      return v.parse(controlResponseSchema, {
        type: "response",
        id,
        ok: false,
        error: { kind: "INVALID_REQUEST", message: "Only the main window can choose a Vault." },
      });
    }
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: "Choose Vault",
      properties: ["openDirectory", "createDirectory"],
    });
    return v.parse(controlResponseSchema, {
      type: "response",
      id,
      ok: true,
      value: result.canceled ? null : result.filePaths[0] ?? null,
    });
  }
  if (method === "dialog.createVault") {
    if (kind !== "main" || !mainWindow) {
      return v.parse(controlResponseSchema, {
        type: "response",
        id,
        ok: false,
        error: { kind: "INVALID_REQUEST", message: "Only the main window can create a Vault." },
      });
    }
    const result = await dialog.showSaveDialog(mainWindow!, {
      title: "Create Vault",
      defaultPath: "Markd Vault",
      buttonLabel: "Create Vault",
    });
    return v.parse(controlResponseSchema, {
      type: "response",
      id,
      ok: true,
      value: result.canceled ? null : result.filePath ?? null,
    });
  }
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
  if (method === "capture.open") showQuickCapture();
  if (method === "capture.close") closeQuickCapture();
  return v.parse(controlResponseSchema, {
    type: "response",
    id,
    ok: true,
    value: null,
  });
});

ipcMain.handle("markd:engine-state", (event): EngineState => {
  if (!windowKinds.has(event.sender.id) || !engineState) {
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
  if (!failure.success || !windowKinds.has(event.sender.id)) return;
  console.error(`[markd-main] invalid engine channel epoch=${engineEpoch}`);
  engine?.kill();
});

ipcMain.on("markd:window-kind", (event) => {
  event.returnValue = v.parse(windowKindSchema, windowKinds.get(event.sender.id));
});

ipcMain.on("markd:notes-changed", (event, input: unknown) => {
  if (senderKind(event) !== "quick-capture" || typeof input !== "string") return;
  const window = mainWindow;
  if (window && !window.isDestroyed()) window.webContents.send("markd:notes-changed", input);
});

app.whenReady().then(() => {
  console.log("[markd-main] app ready");
  protocol.handle("markd-asset", handleAssetRequest);
  mainWindow = createMainWindow();
  mainWindow.webContents.once("did-finish-load", () => {
    if (!captureWindow || captureWindow.isDestroyed()) {
      captureWindow = createCaptureWindow();
    }
  });
  engine = connectEngine();
  mainWindow.on("closed", () => {
    mainWindow = null;
    if (process.platform !== "darwin") app.quit();
  });

  const registered = globalShortcut.register(captureAccelerator, showQuickCapture);
  if (!registered) {
    console.error(`[markd-main] Quick Capture shortcut unavailable: ${captureAccelerator}`);
  }

  app.on("activate", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      return;
    }
    mainWindow = createMainWindow();
    mainWindow.on("closed", () => {
      mainWindow = null;
    });
  });
});

app.on("before-quit", () => {
  quitting = true;
  globalShortcut.unregisterAll();
  engine?.kill();
  engine = null;
});
