import { _electron as electron, expect, test } from "@playwright/test";
import { execFile } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdir, readFile, realpath } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { basename, dirname, join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

test("signed baseline upgrades and relaunches through the real release channel", async () => {
  const baselineExecutable = requiredEnv("RIFFLE_BASELINE_EXECUTABLE");
  const installedApp = requiredEnv("RIFFLE_INSTALLED_APP");
  const targetVersion = requiredEnv("RIFFLE_TARGET_VERSION");
  const baselineVersion = process.env.RIFFLE_BASELINE_VERSION ?? "0.1.10";
  const channelDir = process.env.RIFFLE_UPDATE_CHANNEL_DIR;
  const allowedTempRoot = requiredEnv("RIFFLE_ALLOWED_TEMP_ROOT");
  const stateRoot = dirname(installedApp);
  const targetExecutable = join(installedApp, "Contents", "MacOS", "Riffle");
  const marker = join(stateRoot, "release-evidence.json");
  const configDir = join(stateRoot, "config");
  let server: Server | null = null;
  let application: Awaited<ReturnType<typeof electron.launch>> | null = null;
  let baselinePid: number | null = null;
  let replacementPid: number | null = null;
  let evidenceNonce: string | null = null;
  const derivedApp = dirname(dirname(dirname(baselineExecutable)));
  // The released Markd baseline enforces its original prefix before Riffle can
  // take over, while current-only journeys use the Riffle prefix.
  if (!["riffle-release-e2e-", "markd-release-e2e-"].some((prefix) =>
    basename(stateRoot).startsWith(prefix)
  )) {
    throw new Error("Updater smoke requires an isolated release E2E root.");
  }
  expect(await realpath(dirname(stateRoot))).toBe(await realpath(allowedTempRoot));
  expect(await realpath(derivedApp)).toBe(await realpath(installedApp));
  await mkdir(configDir, { recursive: true });

  try {
    if (channelDir) server = await serveChannel(channelDir);
    application = await electron.launch({
      executablePath: baselineExecutable,
      env: {
        ...process.env,
        RIFFLE_E2E_BACKGROUND: "1",
        RIFFLE_E2E_EXPECTED_VERSION: targetVersion,
        RIFFLE_E2E_RELEASE_MARKER: marker,
        RIFFLE_E2E_STATE_ROOT: stateRoot,
        RIFFLE_TEST_CONFIG_DIR: configDir,
        RIFFLE_TEST_QUICK_CAPTURE_ACCELERATOR: "F24",
        RIFFLE_E2E_UPDATE_URL: server ? serverOrigin(server) : "",
        // v0.2.6 predates the rename. The harness speaks both generations so
        // the shipped baseline can hand control to the clean Riffle runtime.
        MARKD_E2E_BACKGROUND: "1",
        MARKD_E2E_EXPECTED_VERSION: targetVersion,
        MARKD_E2E_RELEASE_MARKER: marker,
        MARKD_E2E_STATE_ROOT: stateRoot,
        MARKD_TEST_CONFIG_DIR: configDir,
        MARKD_TEST_QUICK_CAPTURE_ACCELERATOR: "F24",
        MARKD_E2E_UPDATE_URL: server ? serverOrigin(server) : "",
      },
    });
    const page = await mainWindow(application);
    expect(await application.evaluate(({ app, BrowserWindow }) => ({
      version: app.getVersion(),
      active: app.isActive(),
      focused: BrowserWindow.getFocusedWindow() !== null,
      visible: BrowserWindow.getAllWindows().some((window) => window.isVisible()),
    }))).toEqual({
      version: baselineVersion,
      active: false,
      focused: false,
      visible: false,
    });

    await expect.poll(() => readMarker(marker), { timeout: 30_000 }).toMatchObject({
      version: baselineVersion,
      executable: baselineExecutable,
    });
    const baselineEvidence = await readMarker(marker);
    if (!baselineEvidence) throw new Error("Baseline Riffle did not produce release evidence.");
    baselinePid = baselineEvidence.pid;
    evidenceNonce = baselineEvidence.nonce;
    await expect.poll(async () => {
      const result = await page.evaluate(() => {
        const bridge = window.riffle ??
          (window as typeof window & { markd?: typeof window.riffle }).markd;
        return bridge!.updates!.check();
      });
      return result.ok ? result.value : { error: result.error };
    }, { timeout: 2 * 60_000 }).toMatchObject({
      id: targetVersion,
      currentVersion: baselineVersion,
      version: targetVersion,
    });
    await expect(page.evaluate((version) => {
      const bridge = window.riffle ??
        (window as typeof window & { markd?: typeof window.riffle }).markd;
      return bridge!.updates!.install(version);
    }, targetVersion))
      .resolves.toEqual({ ok: true, value: null });
    const exited = application.waitForEvent("close");
    await expect(page.evaluate(() => {
      const bridge = window.riffle ??
        (window as typeof window & { markd?: typeof window.riffle }).markd;
      return bridge!.updates!.relaunch();
    }))
      .resolves.toEqual({ ok: true, value: null });
    await exited;
    await expect.poll(() => processAlive(baselinePid!)).toBe(false);

    await expect.poll(() => readMarker(marker), {
      timeout: 3 * 60_000,
    }).toMatchObject({
      version: targetVersion,
      executable: targetExecutable,
      nonce: baselineEvidence.nonce,
    });
    const replacement = await readMarker(marker);
    if (!replacement || replacement.version !== targetVersion) {
      throw new Error("Updated Riffle did not produce relaunch evidence.");
    }
    replacementPid = replacement.pid;
    expect(replacementPid).not.toBe(baselinePid);
    process.kill(replacementPid, 0);

    const plist = join(installedApp, "Contents", "Info.plist");
    const [{ stdout: version }, { stdout: bundleId }] = await Promise.all([
      execFileAsync("/usr/libexec/PlistBuddy", ["-c", "Print :CFBundleShortVersionString", plist]),
      execFileAsync("/usr/libexec/PlistBuddy", ["-c", "Print :CFBundleIdentifier", plist]),
    ]);
    expect(version.trim()).toBe(targetVersion);
    expect(bundleId.trim()).toBe("app.usemarkd");
  } finally {
    const cleanupErrors: Error[] = [];
    const finalEvidence = evidenceNonce
      ? await waitForEvidence(marker, evidenceNonce, targetExecutable, baselinePid)
      : await readMarker(marker);
    const cleanupPid =
      finalEvidence &&
      evidenceNonce &&
      finalEvidence.nonce === evidenceNonce &&
      finalEvidence.executable === targetExecutable &&
      finalEvidence.pid !== baselinePid
        ? finalEvidence.pid
        : replacementPid;
    if (cleanupPid && processAlive(cleanupPid)) {
      try {
        process.kill(cleanupPid, "SIGTERM");
        await waitForExit(cleanupPid);
      } catch (error) {
        cleanupErrors.push(asError(error));
      }
    }
    const attachedPid = baselinePid ?? application?.process().pid ?? null;
    if (application && attachedPid && processAlive(attachedPid)) {
      try {
        await application.close();
        await waitForExit(attachedPid);
      } catch (error) {
        cleanupErrors.push(asError(error));
      }
    }
    try {
      const pids = new Set([
        ...await exactExecutablePids(baselineExecutable),
        ...await exactExecutablePids(targetExecutable),
      ]);
      for (const pid of pids) {
        process.kill(pid, "SIGTERM");
        await waitForExit(pid);
      }
    } catch (error) {
      cleanupErrors.push(asError(error));
    }
    if (server) {
      try {
        await closeServer(server);
      } catch (error) {
        cleanupErrors.push(asError(error));
      }
    }
    // Hygiene restore owns the disposable app root so shared updater state is restored first.
    if (cleanupErrors.length > 0) throw new AggregateError(cleanupErrors, "Updater smoke cleanup failed.");
  }
});

async function mainWindow(application: Awaited<ReturnType<typeof electron.launch>>) {
  await application.firstWindow();
  await expect.poll(async () => {
    const kinds = await Promise.all(application.windows().map((page) =>
      page.evaluate(() => {
        const bridge = window.riffle ??
          (window as typeof window & { markd?: typeof window.riffle }).markd;
        return bridge?.app.windowKind ?? null;
      }).catch(() => null),
    ));
    return kinds.includes("main");
  }).toBe(true);
  for (const page of application.windows()) {
    if (await page.evaluate(() => {
      const bridge = window.riffle ??
        (window as typeof window & { markd?: typeof window.riffle }).markd;
      return bridge?.app.windowKind ?? null;
    }) === "main") return page;
  }
  throw new Error("Riffle main window did not load.");
}

async function readMarker(path: string) {
  try {
    return JSON.parse(await readFile(path, "utf8")) as {
      version: string;
      pid: number;
      executable: string;
      nonce: string;
    };
  } catch {
    return null;
  }
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForExit(pid: number): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (processAlive(pid) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (processAlive(pid)) throw new Error(`Riffle process ${pid} did not exit.`);
}

async function waitForEvidence(
  path: string,
  nonce: string,
  executable: string,
  excludedPid: number | null,
) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const evidence = await readMarker(path);
    if (
      evidence?.nonce === nonce &&
      evidence.executable === executable &&
      evidence.pid !== excludedPid
    ) return evidence;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return readMarker(path);
}

async function serveChannel(directory: string): Promise<Server> {
  const allowed = new Set([
    "latest-mac.yml",
    `Riffle-${requiredEnv("RIFFLE_TARGET_VERSION")}-mac-arm64.zip`,
    `Riffle-${requiredEnv("RIFFLE_TARGET_VERSION")}-mac-arm64.zip.blockmap`,
  ]);
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const name = basename(decodeURIComponent(url.pathname));
    if (!allowed.has(name)) {
      response.writeHead(404).end();
      return;
    }
    try {
      const content = await readFile(join(directory, name));
      response.writeHead(200, { "content-length": String(content.byteLength) });
      response.end(content);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return server;
}

function serverOrigin(server: Server): string {
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}/`;
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) =>
    server.close((error) => error ? reject(error) : resolve()),
  );
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

async function exactExecutablePids(executable: string): Promise<number[]> {
  const { stdout } = await execFileAsync("ps", ["-axo", "pid=,command="]);
  return stdout.split("\n").flatMap((line) => {
    const match = line.match(/^\s*(\d+)\s+(.+)$/u);
    if (!match) return [];
    const command = match[2];
    return command === executable || command.startsWith(`${executable} `) ? [Number(match[1])] : [];
  });
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
