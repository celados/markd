import { _electron as electron, expect, test } from "@playwright/test";

test("secure shell boots with a validated semantic bridge and diagnostics", async () => {
  const application = await electron.launch({ args: ["."] });
  const diagnostics: string[] = [];
  application.process().stdout?.on("data", (chunk) => {
    diagnostics.push(String(chunk));
  });
  try {
    const page = await application.firstWindow();
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(String(error)));

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

test("utility crash rejects outstanding calls and spends one restart", async () => {
  const application = await electron.launch({ args: ["."] });
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
  const application = await electron.launch({
    args: ["."],
    env: {
      ...process.env,
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
        message: "Markd Engine exited unexpectedly.",
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
  const application = await electron.launch({
    args: ["."],
    env: { ...process.env, MARKD_ENABLE_DEVTOOLS: "1" },
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
