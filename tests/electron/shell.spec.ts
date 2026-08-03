import { expect, test } from "@playwright/test";
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { launchMarkd, markdWindow } from "./launch-markd";

test("secure shell boots with a validated semantic bridge and diagnostics", async () => {
  const application = await launchMarkd();
  const diagnostics: string[] = [];
  application.process().stdout?.on("data", (chunk) => {
    diagnostics.push(String(chunk));
  });
  try {
    const page = await markdWindow(application, "main");
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(String(error)));

    const backgroundState = await application.evaluate(({ app, BrowserWindow }) => ({
      // Electron only exposes isActive on macOS. Window focus/visibility are the
      // portable contract; activation additionally guards the user's macOS session.
      active: process.platform === "darwin" ? app.isActive() : null,
      focused: BrowserWindow.getFocusedWindow() !== null,
      visible: BrowserWindow.getAllWindows()[0]?.isVisible() ?? true,
    }));
    expect(backgroundState.visible).toBe(false);
    expect(backgroundState.focused).toBe(false);
    if (process.platform === "darwin") expect(backgroundState.active).toBe(false);

    await expect(page).toHaveTitle("Markd");
    await expect(page.getByText("Plain markdown notes. Yours, on disk.")).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() => ({
          bridgeModules: Object.keys(window.markd ?? {}).sort(),
          hasNodeProcess: "process" in window,
          hasRequire: "require" in window,
          hasIpcRenderer: "ipcRenderer" in window,
        })),
      )
      .toEqual({
        bridgeModules: ["app", "capture", "collections", "updates", "vault"],
        hasNodeProcess: false,
        hasRequire: false,
        hasIpcRenderer: false,
      });

    await expect
      .poll(() => page.evaluate(() => window.markd!.vault.startup()))
      .toEqual({ ok: true, value: null });
    await expect
      .poll(() => page.evaluate(() => window.markd!.updates.install("missing")))
      .toEqual({
        ok: false,
        error: {
          kind: "NOT_AVAILABLE",
          message: "No update is ready to install.",
        },
      });
    await expect.poll(() => diagnostics.join("")).toContain("[markd-main] engine ready epoch=1");
    await expect.poll(() => diagnostics.join("")).toContain("[markd-engine] ready epoch=1");
    expect(pageErrors).toEqual([]);
  } finally {
    await application.close();
  }
});

test("real Vault Engine and native shell complete the first Vault slice", async () => {
  const scratch = await mkdtemp(join(tmpdir(), "markd-electron-vault-"));
  const configDir = join(scratch, "config");
  const chosenVault = join(scratch, "chosen-vault");
  const createdVault = join(scratch, "created-vault");
  await mkdir(configDir, { recursive: true });
  await mkdir(chosenVault, { recursive: true });
  await writeFile(join(chosenVault, "Existing.md"), "existing");
  await writeFile(
    join(configDir, "config.json"),
    JSON.stringify({ vaultPath: chosenVault, theme: "system" }),
  );
  const application = await launchMarkd({
    env: { MARKD_TEST_CONFIG_DIR: configDir },
  });
  try {
    const page = await markdWindow(application, "main");
    await expect(page.getByRole("treeitem", { name: "Existing.md" })).toBeVisible();

    await application.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [path],
      });
    }, chosenVault);
    const chosen = await page.evaluate(() => window.markd!.vault.choose());
    expect(chosen).toEqual({
      ok: true,
      value: expect.objectContaining({
        root: await realpath(chosenVault),
        tree: [expect.objectContaining({ rel: "Existing.md", kind: "note" })],
      }),
    });

    await page.getByRole("button", { name: "New note" }).click();
    const untitled = page.getByRole("treeitem", { name: "Untitled.md" });
    await expect(untitled).toBeVisible();
    await expect(page.getByRole("tab", { name: /Untitled/ })).toBeVisible();
    expect(await page.evaluate(() => window.markd!.vault.readNote("Untitled.md"))).toEqual({
      ok: true,
      value: "",
    });
    expect(
      await page.evaluate(() => window.markd!.vault.writeNote("Untitled.md", "saved")),
    ).toEqual({ ok: true, value: null });
    expect(await readFile(join(chosenVault, "Untitled.md"), "utf8")).toBe("saved");

    const traversal = await page.evaluate(() => window.markd!.vault.readNote("../outside.md"));
    expect(traversal).toEqual({
      ok: false,
      error: expect.objectContaining({ kind: "INVALID_PATH" }),
    });
    const outside = join(scratch, "outside.md");
    await writeFile(outside, "outside");
    await symlink(outside, join(chosenVault, "Escape.md"));
    expect(await page.evaluate(() => window.markd!.vault.readNote("Escape.md"))).toEqual({
      ok: false,
      error: expect.objectContaining({ kind: "INVALID_PATH" }),
    });
    await mkdir(join(chosenVault, "Real"));
    await writeFile(join(chosenVault, "Real", "Inside.md"), "inside");
    await symlink("Real/Inside.md", join(chosenVault, "Alias.md"));
    await symlink("Real", join(chosenVault, "AliasFolder"));
    await mkdir(join(chosenVault, "notes", "node_modules"), { recursive: true });
    await writeFile(join(chosenVault, "notes", "node_modules", "Invisible.md"), "invisible");
    for (const rel of ["Alias.md", "AliasFolder/Inside.md", "notes/node_modules/Invisible.md"]) {
      expect(await page.evaluate((path) => window.markd!.vault.readNote(path), rel)).toEqual({
        ok: false,
        error: expect.objectContaining({ kind: "INVALID_PATH" }),
      });
    }
    expect(await page.evaluate(() => window.markd!.vault.moveToTrash("Alias.md"))).toEqual({
      ok: false,
      error: expect.objectContaining({ kind: "INVALID_PATH" }),
    });
    expect(await readFile(join(chosenVault, "Real", "Inside.md"), "utf8")).toBe("inside");

    await untitled.click({ button: "right" });
    const responsiveness = page.evaluate(
      () => new Promise<string>((resolve) => setTimeout(() => resolve("responsive"), 0)),
    );
    await page.getByRole("menuitem", { name: "Move to Trash" }).click();
    await expect(responsiveness).resolves.toBe("responsive");
    await expect(untitled).toHaveCount(0);
    await expect(page.getByRole("tab", { name: /Untitled/ })).toHaveCount(0);
    expect(await page.evaluate(() => window.markd!.vault.snapshot())).toEqual({
      ok: true,
      value: expect.objectContaining({
        tree: expect.arrayContaining([expect.objectContaining({ rel: "Existing.md" })]),
      }),
    });

    await application.evaluate(({ dialog }, path) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
    }, createdVault);
    const fresh = await page.evaluate(() => window.markd!.vault.create());
    expect(fresh).toEqual({
      ok: true,
      value: expect.objectContaining({ root: await realpath(createdVault), tree: [] }),
    });
  } finally {
    await application.close();
    await rm(scratch, { recursive: true, force: true });
  }
});

test("native Trash failure remains tagged and leaves the snapshot coherent", async () => {
  const scratch = await mkdtemp(join(tmpdir(), "markd-electron-trash-failure-"));
  const configDir = join(scratch, "config");
  const vault = join(scratch, "vault");
  await mkdir(configDir, { recursive: true });
  await mkdir(vault, { recursive: true });
  await writeFile(join(vault, "Untitled.md"), "");
  await writeFile(
    join(configDir, "config.json"),
    JSON.stringify({ vaultPath: vault, theme: "system" }),
  );
  const application = await launchMarkd({
    env: {
      MARKD_TEST_CONFIG_DIR: configDir,
      MARKD_TEST_TRASH_FAILURE: "1",
    },
  });
  try {
    const page = await markdWindow(application, "main");
    await expect
      .poll(() => page.evaluate(() => window.markd!.vault.startup()))
      .toEqual({
        ok: true,
        value: expect.objectContaining({ tree: [expect.objectContaining({ rel: "Untitled.md" })] }),
      });
    expect(await page.evaluate(() => window.markd!.vault.moveToTrash("Untitled.md"))).toEqual({
      ok: false,
      error: expect.objectContaining({ kind: "NATIVE_OPERATION_FAILED" }),
    });
    expect(await page.evaluate(() => window.markd!.vault.snapshot())).toEqual({
      ok: true,
      value: expect.objectContaining({ tree: [expect.objectContaining({ rel: "Untitled.md" })] }),
    });
  } finally {
    await application.close();
    await rm(scratch, { recursive: true, force: true });
  }
});

test("Pins persist in the Vault and canonical paths expand a Vault symlink", async () => {
  const scratch = await mkdtemp(join(tmpdir(), "markd-electron-pins-"));
  const configDir = join(scratch, "config");
  const vault = join(scratch, "vault");
  const vaultAlias = join(scratch, "vault-alias");
  await mkdir(configDir, { recursive: true });
  await mkdir(vault, { recursive: true });
  await writeFile(join(vault, "Kept.md"), "kept");
  await writeFile(join(vault, "Removed.md"), "removed");
  await symlink(vault, vaultAlias);
  await writeFile(
    join(configDir, "config.json"),
    JSON.stringify({ vaultPath: vaultAlias, theme: "system" }),
  );

  const first = await launchMarkd({ env: { MARKD_TEST_CONFIG_DIR: configDir } });
  try {
    const page = await markdWindow(first, "main");
    await expect.poll(() => page.evaluate(() => window.markd!.vault.startup()))
      .toEqual({ ok: true, value: expect.objectContaining({ root: await realpath(vault) }) });
    expect(await page.evaluate(() => window.markd!.vault.pins.add("Kept.md"))).toEqual({
      ok: true,
      value: { pins: ["Kept.md"], stale: [] },
    });
    expect(await page.evaluate(() => window.markd!.vault.pins.add("Removed.md"))).toEqual({
      ok: true,
      value: { pins: ["Removed.md", "Kept.md"], stale: [] },
    });
    expect(await page.evaluate(() => window.markd!.vault.resolveNotePath("Kept.md"))).toEqual({
      ok: true,
      value: join(await realpath(vault), "Kept.md"),
    });
  } finally {
    await first.close();
  }

  await rm(join(vault, "Removed.md"));
  const second = await launchMarkd({ env: { MARKD_TEST_CONFIG_DIR: configDir } });
  try {
    const page = await markdWindow(second, "main");
    await expect.poll(() => page.evaluate(() => window.markd!.vault.startup()))
      .toEqual({ ok: true, value: expect.objectContaining({ root: await realpath(vault) }) });
    expect(await page.evaluate(() => window.markd!.vault.pins.list())).toEqual({
      ok: true,
      value: { pins: ["Kept.md"], stale: ["Removed.md"] },
    });
    expect(await page.evaluate(() => window.markd!.vault.pins.remove("Removed.md"))).toEqual({
      ok: true,
      value: { pins: ["Kept.md"], stale: [] },
    });
    expect(JSON.parse(await readFile(join(vault, ".markd", "pins.json"), "utf8"))).toEqual([
      "Kept.md",
    ]);
  } finally {
    await second.close();
    await rm(scratch, { recursive: true, force: true });
  }
});

test("Collections persist across Vault switches and utility restarts", async () => {
  const scratch = await mkdtemp(join(tmpdir(), "markd-electron-collections-"));
  const configDir = join(scratch, "config");
  const firstVault = join(scratch, "first-vault");
  const secondVault = join(scratch, "second-vault");
  await mkdir(configDir, { recursive: true });
  await mkdir(firstVault, { recursive: true });
  await mkdir(secondVault, { recursive: true });
  await writeFile(join(firstVault, "Visible.md"), "visible");
  await writeFile(
    join(configDir, "config.json"),
    JSON.stringify({ vaultPath: firstVault, theme: "system" }),
  );

  const first = await launchMarkd({ env: { MARKD_TEST_CONFIG_DIR: configDir } });
  try {
    const page = await first.firstWindow();
    await expect
      .poll(() => page.evaluate(() => window.markd!.vault.startup()))
      .toEqual({
        ok: true,
        value: expect.objectContaining({ tree: [expect.objectContaining({ rel: "Visible.md" })] }),
      });
    const todo = await page.evaluate(() =>
      window.markd!.collections.todos.create("Ship Electron", ["Work"]),
    );
    const bookmark = await page.evaluate(() =>
      window.markd!.collections.bookmarks.create("example.com/read", ["Later"]),
    );
    expect(todo).toEqual({
      ok: true,
      value: expect.objectContaining({
        item: expect.objectContaining({ text: "Ship Electron", tags: ["work"] }),
      }),
    });
    expect(bookmark).toEqual({
      ok: true,
      value: expect.objectContaining({
        item: expect.objectContaining({ url: "https://example.com/read", tags: ["later"] }),
      }),
    });
    expect(await page.evaluate(() => window.markd!.vault.snapshot())).toEqual({
      ok: true,
      value: expect.objectContaining({
        tree: [expect.objectContaining({ rel: "Visible.md" })],
      }),
    });

    await first.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
    }, secondVault);
    expect(await page.evaluate(() => window.markd!.vault.choose())).toEqual({
      ok: true,
      value: expect.objectContaining({ root: await realpath(secondVault), tree: [] }),
    });
    expect(await page.evaluate(() => window.markd!.collections.snapshot())).toEqual({
      ok: true,
      value: { todos: [], todoTags: [], bookmarks: [], bookmarkTags: [] },
    });

    await first.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
    }, firstVault);
    await page.evaluate(() => window.markd!.vault.choose());
    expect(await page.evaluate(() => window.markd!.collections.snapshot())).toEqual({
      ok: true,
      value: expect.objectContaining({
        todos: [expect.objectContaining({ text: "Ship Electron" })],
        bookmarks: [expect.objectContaining({ url: "https://example.com/read" })],
      }),
    });
    expect(
      await page.evaluate(() =>
        window.markd!.collections.todos.change("missing", { type: "toggle" }),
      ),
    ).toEqual({
      ok: false,
      error: expect.objectContaining({ kind: "NOT_FOUND" }),
    });
  } finally {
    await first.close();
  }

  const restarted = await launchMarkd({ env: { MARKD_TEST_CONFIG_DIR: configDir } });
  try {
    const page = await restarted.firstWindow();
    await expect
      .poll(() => page.evaluate(() => window.markd!.vault.startup()))
      .toEqual({
        ok: true,
        value: expect.objectContaining({ root: await realpath(firstVault) }),
      });
    expect(await page.evaluate(() => window.markd!.collections.snapshot())).toEqual({
      ok: true,
      value: expect.objectContaining({
        todos: [expect.objectContaining({ text: "Ship Electron" })],
        bookmarks: [expect.objectContaining({ url: "https://example.com/read" })],
      }),
    });
  } finally {
    await restarted.close();
    await rm(scratch, { recursive: true, force: true });
  }
});

test("utility crash rejects outstanding calls and spends one restart", async () => {
  const application = await launchMarkd();
  try {
    const page = await markdWindow(application, "main");
    await expect(page).toHaveTitle("Markd");
    await expect
      .poll(() => page.evaluate(() => window.markd!.vault.startup()))
      .toEqual({ ok: true, value: null });

    const firstPid = await application.evaluate(({ app }) => {
      process.env.MARKD_ENGINE_READY_DELAY_MS = "1000";
      const metric = app.getAppMetrics().find((candidate) => candidate.name === "Markd Engine");
      if (!metric) throw new Error("Markd Engine process was not registered");
      process.kill(metric.pid);
      return metric.pid;
    });

    const replacementPid = await expect
      .poll(async () => {
        const metrics = await application.evaluate(({ app }) => app.getAppMetrics());
        return metrics.find(
          (candidate) => candidate.name === "Markd Engine" && candidate.pid !== firstPid,
        )?.pid;
      })
      .toBeTruthy()
      .then(async () => {
        const metrics = await application.evaluate(({ app }) => app.getAppMetrics());
        return metrics.find(
          (candidate) => candidate.name === "Markd Engine" && candidate.pid !== firstPid,
        )!.pid;
      });

    await page.evaluate(() => {
      const state = window as typeof window & { __engineResult?: unknown };
      void window.markd!.vault.startup().then((result) => {
        state.__engineResult = result;
      });
    });
    await application.evaluate((_electron, pid) => process.kill(pid), replacementPid);

    await expect
      .poll(() =>
        page.evaluate(
          () => (window as typeof window & { __engineResult?: unknown }).__engineResult,
        ),
      )
      .toEqual({
        ok: false,
        error: {
          kind: "ENGINE_UNAVAILABLE",
          message: "Markd Engine is unavailable.",
        },
      });

    await page.waitForTimeout(1_200);
    const remainingEnginePids = await application.evaluate(({ app }) =>
      app
        .getAppMetrics()
        .filter((candidate) => candidate.name === "Markd Engine")
        .map((candidate) => candidate.pid),
    );
    expect(remainingEnginePids).toEqual([]);
  } finally {
    await application.evaluate(() => {
      delete process.env.MARKD_ENGINE_READY_DELAY_MS;
    });
    await application.close();
  }
});

test("pre-port generation failure resolves startup and restarts only once", async () => {
  test.setTimeout(15_000);
  const application = await launchMarkd({
    env: {
      MARKD_TEST_ABORT_ENGINE_EPOCH: "1",
      MARKD_TEST_ABORT_DELAY_MS: "1000",
      MARKD_TEST_ENGINE_TRANSFER_DELAY_MS: "2000",
    },
  });
  const diagnostics: string[] = [];
  application.process().stdout?.on("data", (chunk) => {
    diagnostics.push(String(chunk));
  });
  application.process().stderr?.on("data", (chunk) => {
    diagnostics.push(String(chunk));
  });
  try {
    const page = await markdWindow(application, "main");
    const result = await page.evaluate(() => window.markd!.vault.startup());
    expect(result).toEqual({
      ok: false,
      error: {
        kind: "ENGINE_UNAVAILABLE",
        message: "Markd Engine is unavailable.",
      },
    });

    await expect
      .poll(() => diagnostics.join(""), { timeout: 8_000 })
      .toContain("[markd-main] engine ready epoch=2");
    const output = diagnostics.join("");
    expect(output.match(/restarting engine after epoch=1/g)).toHaveLength(1);
    expect(output.match(/engine spawned epoch=/g)).toHaveLength(2);
    expect(output).not.toContain("engine spawned epoch=3");
  } finally {
    await application.close();
  }
});

test("development shortcut opens Chromium DevTools", async () => {
  const application = await launchMarkd({
    env: { MARKD_ENABLE_DEVTOOLS: "1" },
  });
  try {
    await markdWindow(application, "main");
    await application.evaluate(async ({ BrowserWindow }) => {
      for (const window of BrowserWindow.getAllWindows()) {
        const kind = await window.webContents.executeJavaScript(
          "window.markd.app.windowKind",
        );
        if (kind !== "main") continue;
        window.webContents.sendInputEvent({ type: "keyDown", keyCode: "F12" });
      }
    });
    await expect
      .poll(() =>
        application.evaluate(async ({ BrowserWindow }) => {
          for (const window of BrowserWindow.getAllWindows()) {
            const kind = await window.webContents.executeJavaScript(
              "window.markd.app.windowKind",
            );
            if (kind === "main") return window.webContents.isDevToolsOpened();
          }
          return false;
        }),
      )
      .toBe(true);
  } finally {
    await application.close();
  }
});

test("Quick Capture shares the Engine without foreground activation", async () => {
  const scratch = await mkdtemp(join(tmpdir(), "markd-electron-capture-"));
  const configDir = join(scratch, "config");
  const vault = join(scratch, "vault");
  await mkdir(configDir, { recursive: true });
  await mkdir(vault, { recursive: true });
  await writeFile(
    join(configDir, "config.json"),
    JSON.stringify({ vaultPath: vault, theme: "system" }),
  );
  const application = await launchMarkd({
    env: {
      MARKD_TEST_CONFIG_DIR: configDir,
      MARKD_ENGINE_TEST_CAPTURE_DELAY_MS: "400",
      // Exercise a real OS registration without stealing the user's production shortcut.
      MARKD_TEST_QUICK_CAPTURE_ACCELERATOR: "F24",
    },
  });
  try {
    await expect.poll(() => application.windows().length).toBe(2);
    const pages = application.windows();
    const kinds = await Promise.all(
      pages.map(async (page) => [
        await page.evaluate(() => window.markd!.app.windowKind),
        page,
      ] as const),
    );
    const mainPage = kinds.find(([kind]) => kind === "main")?.[1];
    const capturePage = kinds.find(([kind]) => kind === "quick-capture")?.[1];
    if (!mainPage || !capturePage) throw new Error("Markd windows did not load");

    await expect
      .poll(() => mainPage.evaluate(() => window.markd!.vault.startup()))
      .toEqual({ ok: true, value: expect.objectContaining({ root: await realpath(vault) }) });
    expect(
      await application.evaluate(({ globalShortcut }) =>
        globalShortcut.isRegistered("F24"),
      ),
    ).toBe(true);
    expect(await mainPage.evaluate(() => window.markd!.capture.open())).toEqual({
      ok: true,
      value: null,
    });

    const backgroundState = await application.evaluate(({ app, BrowserWindow }) => ({
      active: process.platform === "darwin" ? app.isActive() : null,
      focused: BrowserWindow.getFocusedWindow() !== null,
      visible: BrowserWindow.getAllWindows().some((window) => window.isVisible()),
    }));
    expect(backgroundState.visible).toBe(false);
    expect(backgroundState.focused).toBe(false);
    if (process.platform === "darwin") expect(backgroundState.active).toBe(false);

    await capturePage.getByPlaceholder("Title").fill("Inbox");
    await capturePage
      .getByPlaceholder("Write something worth keeping…")
      .fill("first thought");
    await capturePage.getByRole("button", { name: "Create captured note" }).click();
    await application.evaluate(async ({ BrowserWindow }) => {
      for (const window of BrowserWindow.getAllWindows()) {
        const kind = await window.webContents.executeJavaScript(
          "window.markd.app.windowKind",
        );
        if (kind === "quick-capture") window.close();
      }
    });
    expect(await mainPage.evaluate(() => window.markd!.capture.open())).toEqual({
      ok: true,
      value: null,
    });
    await expect(capturePage.getByPlaceholder("Title")).toBeDisabled();
    await expect(capturePage.getByPlaceholder("Title")).toHaveValue("Inbox");
    await expect(
      capturePage.getByPlaceholder("Write something worth keeping…"),
    ).toHaveValue("first thought");
    await expect
      .poll(() => readFile(join(vault, "Inbox.md"), "utf8").catch(() => null))
      .toBe("first thought");
    expect(await mainPage.evaluate(() => window.markd!.capture.open())).toEqual({
      ok: true,
      value: null,
    });
    await expect(capturePage.getByPlaceholder("Title")).toBeEnabled();
    await expect(capturePage.getByPlaceholder("Title")).toHaveValue("");
    expect(await capturePage.evaluate(() =>
      window.markd!.capture.append("Inbox.md", "second thought"),
    )).toEqual({
      ok: true,
      value: expect.objectContaining({ rel: "Inbox.md" }),
    });
    expect(await readFile(join(vault, "Inbox.md"), "utf8")).toBe(
      "first thought\nsecond thought",
    );

    const firstEnginePid = await application.evaluate(
      ({ app }) =>
        app.getAppMetrics().find((candidate) => candidate.name === "Markd Engine")
          ?.pid,
    );
    if (!firstEnginePid) throw new Error("Markd Engine process was not registered");
    await application.evaluate((_electron, pid) => process.kill(pid), firstEnginePid);
    await expect
      .poll(() =>
        application.evaluate(
          ({ app }, oldPid) =>
            app
              .getAppMetrics()
              .some(
                (candidate) =>
                  candidate.name === "Markd Engine" && candidate.pid !== oldPid,
              ),
          firstEnginePid,
        ),
      )
      .toBe(true);
    await expect
      .poll(() =>
        capturePage.evaluate(() =>
          window.markd!.capture.append("Inbox.md", "after restart"),
        ),
      )
      .toEqual({
        ok: true,
        value: expect.objectContaining({ rel: "Inbox.md" }),
      });
    expect(await readFile(join(vault, "Inbox.md"), "utf8")).toBe(
      "first thought\nsecond thought\nafter restart",
    );
  } finally {
    await application.close();
    await rm(scratch, { recursive: true, force: true });
  }
});
