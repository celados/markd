import { _electron as electron, expect, test } from "@playwright/test";
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runSecureContentJourney } from "../shared/secure-content-journey";

test("packaged utility queries the configured Vault", async () => {
  const executablePath = process.env.RIFFLE_PACKAGED_EXECUTABLE;
  if (!executablePath) throw new Error("RIFFLE_PACKAGED_EXECUTABLE is required.");
  const scratch = await mkdtemp(join(tmpdir(), "riffle-packaged-smoke-"));
  const configDir = join(scratch, "config");
  const vault = join(scratch, "vault");
  await mkdir(configDir, { recursive: true });
  await mkdir(vault, { recursive: true });
  await writeFile(join(vault, "Packaged.md"), "native fff query");
  await writeFile(
    join(configDir, "config.json"),
    JSON.stringify({ vaultPath: vault, theme: "system" }),
  );

  const application = await electron.launch({
    executablePath,
    env: {
      ...process.env,
      RIFFLE_E2E_BACKGROUND: "1",
      RIFFLE_TEST_CONFIG_DIR: configDir,
      RIFFLE_TEST_QUICK_CAPTURE_ACCELERATOR: "F24",
    },
  });
  try {
    const page = await application.firstWindow();
    await expect.poll(() => page.evaluate(() => window.riffle?.vault.startup())).toEqual({
      ok: true,
      value: expect.objectContaining({
        root: await realpath(vault),
        tree: [expect.objectContaining({ rel: "Packaged.md", kind: "note" })],
      }),
    });
  } finally {
    await application.close();
    await rm(scratch, { recursive: true, force: true });
  }
});

test("packaged app keeps assets and native exports inside canonical paths", async () => {
  const executablePath = process.env.RIFFLE_PACKAGED_EXECUTABLE;
  if (!executablePath) throw new Error("RIFFLE_PACKAGED_EXECUTABLE is required.");

  await runSecureContentJourney((configDir) => electron.launch({
    executablePath,
    env: {
      ...process.env,
      RIFFLE_E2E_BACKGROUND: "1",
      RIFFLE_TEST_CONFIG_DIR: configDir,
      RIFFLE_TEST_QUICK_CAPTURE_ACCELERATOR: "F24",
    },
  }));
});

test("packaged app completes release-critical desktop journeys in background", async () => {
  test.setTimeout(90_000);
  const executablePath = process.env.RIFFLE_PACKAGED_EXECUTABLE;
  if (!executablePath) throw new Error("RIFFLE_PACKAGED_EXECUTABLE is required.");
  const scratch = await mkdtemp(join(tmpdir(), "riffle-packaged-release-"));
  const configDir = join(scratch, "config");
  const vault = join(scratch, "vault");
  await mkdir(configDir, { recursive: true });
  await mkdir(join(vault, "node_modules", "fixture"), { recursive: true });
  await writeFile(join(vault, "Search.md"), "release channel needle");
  await writeFile(
    join(vault, "node_modules", "fixture", "Ignored.md"),
    "release channel needle",
  );

  const application = await electron.launch({
    executablePath,
    env: {
      ...process.env,
      RIFFLE_E2E_BACKGROUND: "1",
      RIFFLE_TEST_CONFIG_DIR: configDir,
      RIFFLE_TEST_QUICK_CAPTURE_ACCELERATOR: "F24",
    },
  });
  try {
    const page = await mainWindow(application);
    const runtimeErrors: string[] = [];
    page.on("pageerror", (error) => runtimeErrors.push(String(error)));
    page.on("console", (message) => {
      if (message.type() === "error") runtimeErrors.push(message.text());
    });

    expect(await application.evaluate(({ app, BrowserWindow }) => ({
      active: process.platform === "darwin" ? app.isActive() : null,
      focused: BrowserWindow.getFocusedWindow() !== null,
      visible: BrowserWindow.getAllWindows().some((window) => window.isVisible()),
    }))).toEqual({ active: false, focused: false, visible: false });

    await page.keyboard.press("ControlOrMeta+,");
    const settings = page.getByRole("dialog", { name: "Settings" });
    await expect(settings).toBeVisible();
    for (const name of ["Riffle Cloud", "Appearance", "Shortcuts", "General"]) {
      await settings.getByRole("button", { name }).click();
      await expect(settings.getByRole("heading", { name, exact: true })).toBeVisible();
    }
    await page.keyboard.press("Escape");

    await application.evaluate(({ dialog }, selectedVault) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [selectedVault],
      });
    }, vault);
    await expect.poll(() => page.evaluate(() => window.riffle!.vault.choose())).toEqual({
      ok: true,
      value: expect.objectContaining({ root: await realpath(vault) }),
    });

    await page.getByRole("treeitem", { name: "Search.md" }).click();
    await page.getByRole("button", { name: "Show Markdown source" }).click();
    const source = page.locator('[data-note-editor="active"] .cm-content');
    await expect(source).toBeVisible();
    await source.locator(".cm-line").last().click();
    await page.keyboard.press("End");
    await page.keyboard.insertText(" edited through the packaged renderer");
    await expect.poll(() => readFile(join(vault, "Search.md"), "utf8"))
      .toContain("edited through the packaged renderer");

    await writeFile(join(vault, "Watched.md"), "release channel needle from watch");
    await expect.poll(() => page.evaluate(async () => {
      const result = await window.riffle!.vault.snapshot();
      return result.ok ? result.value.tree.map((entry) => entry.rel) : [];
    })).toContain("Watched.md");
    await expect.poll(() => page.evaluate(async () => {
      const result = await window.riffle!.vault.search("release channel needle", 10);
      return result.ok ? result.value.map((entry) => entry.rel).sort() : [];
    })).toEqual(["Search.md", "Watched.md"]);

    const png =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
    const saved = await page.evaluate((data) => window.riffle!.vault.assets.save(data, "png"), png);
    expect(saved).toEqual({ ok: true, value: expect.stringMatching(/^\.markd\/assets\//u) });
    if (!saved.ok) throw new Error(saved.error.message);
    expect(await page.evaluate(async (rel) => {
      const url = window.riffle!.vault.assets.url(rel);
      if (!url) return null;
      const response = await fetch(url);
      return {
        status: response.status,
        type: response.headers.get("content-type"),
        size: (await response.arrayBuffer()).byteLength,
      };
    }, saved.value)).toEqual({ status: 200, type: "image/png", size: 68 });

    expect(await page.evaluate(() => window.riffle!.capture.open())).toEqual({ ok: true, value: null });
    const capture = await captureWindow(application);
    await capture.getByPlaceholder("Title").fill("Captured");
    await capture.getByPlaceholder("Write something worth keeping…").fill("first capture");
    await capture.getByRole("button", { name: "Create captured note" }).click();
    await expect.poll(() => readFile(join(vault, "Captured.md"), "utf8").catch(() => null))
      .toBe("first capture");
    expect(await page.evaluate(() => window.riffle!.capture.open())).toEqual({ ok: true, value: null });
    await capture.getByRole("button", { name: "Append to note" }).click();
    await capture.getByPlaceholder("Note path (for example Inbox.md)").fill("Captured.md");
    await capture.getByPlaceholder("Write something worth keeping…").fill("second capture");
    await capture.getByRole("button", { name: "Append capture" }).click();
    await expect.poll(() => readFile(join(vault, "Captured.md"), "utf8"))
      .toBe("first capture\nsecond capture");
    expect(await readFile(join(vault, "Captured.md"), "utf8")).toBe(
      "first capture\nsecond capture",
    );

    // The release journey uses the real renderer shortcut so it does not depend on sidebar layout density.
    await page.keyboard.press("ControlOrMeta+N");
    const untitled = page.getByRole("treeitem", { name: "Untitled.md" });
    await expect(untitled).toBeVisible();
    await expect(page.getByRole("tab", { name: /Untitled/u })).toBeVisible();
    expect(await readFile(join(vault, "Untitled.md"), "utf8")).toBe("");
    await untitled.click({ button: "right" });
    const responsiveness = page.evaluate(
      () => new Promise<string>((resolve) => setTimeout(() => resolve("responsive"), 0)),
    );
    await page.getByRole("menuitem", { name: "Move to Trash" }).click();
    await expect(responsiveness).resolves.toBe("responsive");
    await expect(untitled).toHaveCount(0);
    await expect(page.getByRole("tab", { name: /Untitled/u })).toHaveCount(0);
    await expect.poll(() => readFile(join(vault, "Untitled.md"), "utf8").catch(() => null))
      .toBeNull();
    await expect(page.getByRole("button", { name: "Settings" })).toBeEnabled();
    expect(runtimeErrors).toEqual([]);
  } finally {
    await application.close();
    await rm(scratch, { recursive: true, force: true });
  }
});

async function windowByKind(
  application: Awaited<ReturnType<typeof electron.launch>>,
  kind: "main" | "quick-capture",
) {
  await application.firstWindow();
  await expect.poll(async () => {
    const kinds = await Promise.all(application.windows().map((page) =>
      page.evaluate(() => window.riffle?.app.windowKind ?? null).catch(() => null),
    ));
    return kinds.includes(kind);
  }).toBe(true);
  for (const page of application.windows()) {
    if (await page.evaluate(() => window.riffle?.app.windowKind ?? null) === kind) return page;
  }
  throw new Error(`Riffle ${kind} window did not load.`);
}

function mainWindow(application: Awaited<ReturnType<typeof electron.launch>>) {
  return windowByKind(application, "main");
}

function captureWindow(application: Awaited<ReturnType<typeof electron.launch>>) {
  return windowByKind(application, "quick-capture");
}
