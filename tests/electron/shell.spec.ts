import { expect, test } from "@playwright/test";
import {
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { launchMarkd } from "./launch-markd";

test("secure shell boots with a validated semantic bridge and diagnostics", async () => {
  const application = await launchMarkd();
  const diagnostics: string[] = [];
  application.process().stdout?.on("data", (chunk) => {
    diagnostics.push(String(chunk));
  });
  try {
    const page = await application.firstWindow();
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(String(error)));

    const backgroundState = await application.evaluate(({ app, BrowserWindow }) => ({
      active: app.isActive(),
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
        bridgeModules: ["app", "updates", "vault"],
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
    await expect
      .poll(() => diagnostics.join(""))
      .toContain("[markd-main] engine ready epoch=1");
    await expect
      .poll(() => diagnostics.join(""))
      .toContain("[markd-engine] ready epoch=1");
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
    const page = await application.firstWindow();
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
    expect(await page.evaluate(() => window.markd!.vault.readNote("Untitled.md")))
      .toEqual({ ok: true, value: "" });
    expect(await page.evaluate(() =>
      window.markd!.vault.writeNote("Untitled.md", "saved"),
    )).toEqual({ ok: true, value: null });
    expect(await readFile(join(chosenVault, "Untitled.md"), "utf8")).toBe("saved");

    const traversal = await page.evaluate(() =>
      window.markd!.vault.readNote("../outside.md"),
    );
    expect(traversal).toEqual({
      ok: false,
      error: expect.objectContaining({ kind: "INVALID_PATH" }),
    });
    const outside = join(scratch, "outside.md");
    await writeFile(outside, "outside");
    await symlink(outside, join(chosenVault, "Escape.md"));
    expect(await page.evaluate(() => window.markd!.vault.readNote("Escape.md")))
      .toEqual({
        ok: false,
        error: expect.objectContaining({ kind: "INVALID_PATH" }),
      });
    await mkdir(join(chosenVault, "Real"));
    await writeFile(join(chosenVault, "Real", "Inside.md"), "inside");
    await symlink("Real/Inside.md", join(chosenVault, "Alias.md"));
    await symlink("Real", join(chosenVault, "AliasFolder"));
    await mkdir(join(chosenVault, "notes", "node_modules"), { recursive: true });
    await writeFile(
      join(chosenVault, "notes", "node_modules", "Invisible.md"),
      "invisible",
    );
    for (const rel of [
      "Alias.md",
      "AliasFolder/Inside.md",
      "notes/node_modules/Invisible.md",
    ]) {
      expect(await page.evaluate(
        (path) => window.markd!.vault.readNote(path),
        rel,
      )).toEqual({
        ok: false,
        error: expect.objectContaining({ kind: "INVALID_PATH" }),
      });
    }
    expect(await page.evaluate(() => window.markd!.vault.moveToTrash("Alias.md")))
      .toEqual({
        ok: false,
        error: expect.objectContaining({ kind: "INVALID_PATH" }),
      });
    expect(await readFile(join(chosenVault, "Real", "Inside.md"), "utf8"))
      .toBe("inside");

    await untitled.click({ button: "right" });
    const responsiveness = page.evaluate(() =>
      new Promise<string>((resolve) => setTimeout(() => resolve("responsive"), 0)),
    );
    await page.getByRole("menuitem", { name: "Move to Trash" }).click();
    await expect(responsiveness).resolves.toBe("responsive");
    await expect(untitled).toHaveCount(0);
    await expect(page.getByRole("tab", { name: /Untitled/ })).toHaveCount(0);
    expect(await page.evaluate(() => window.markd!.vault.snapshot())).toEqual({
      ok: true,
      value: expect.objectContaining({
        tree: expect.arrayContaining([
          expect.objectContaining({ rel: "Existing.md" }),
        ]),
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
    const page = await application.firstWindow();
    await expect.poll(() => page.evaluate(() => window.markd!.vault.startup())).toEqual({
      ok: true,
      value: expect.objectContaining({ tree: [expect.objectContaining({ rel: "Untitled.md" })] }),
    });
    expect(await page.evaluate(() => window.markd!.vault.moveToTrash("Untitled.md")))
      .toEqual({
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

test("utility crash rejects outstanding calls and spends one restart", async () => {
  const application = await launchMarkd();
  try {
    const page = await application.firstWindow();
    await expect(page).toHaveTitle("Markd");
    await expect
      .poll(() => page.evaluate(() => window.markd!.vault.startup()))
      .toEqual({ ok: true, value: null });

    const firstPid = await application.evaluate(({ app }) => {
      process.env.MARKD_ENGINE_READY_DELAY_MS = "1000";
      const metric = app
        .getAppMetrics()
        .find((candidate) => candidate.name === "Markd Engine");
      if (!metric) throw new Error("Markd Engine process was not registered");
      process.kill(metric.pid);
      return metric.pid;
    });

    const replacementPid = await expect
      .poll(async () => {
        const metrics = await application.evaluate(({ app }) => app.getAppMetrics());
        return metrics.find(
          (candidate) =>
            candidate.name === "Markd Engine" && candidate.pid !== firstPid,
        )?.pid;
      })
      .toBeTruthy()
      .then(async () => {
        const metrics = await application.evaluate(({ app }) => app.getAppMetrics());
        return metrics.find(
          (candidate) =>
            candidate.name === "Markd Engine" && candidate.pid !== firstPid,
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
          () =>
            (window as typeof window & { __engineResult?: unknown }).__engineResult,
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
    const page = await application.firstWindow();
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
    await application.firstWindow();
    await application.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.webContents.sendInputEvent({
        type: "keyDown",
        keyCode: "F12",
      });
    });
    await expect
      .poll(() =>
        application.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0]?.webContents.isDevToolsOpened(),
        ),
      )
      .toBe(true);
  } finally {
    await application.close();
  }
});
