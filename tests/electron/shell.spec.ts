import { expect, test } from "@playwright/test";
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { launchMarkd, markdWindow } from "./launch-markd";

test("secure shell boots with a validated semantic bridge and diagnostics", async () => {
  const application = await launchMarkd({
    env: {
      // Inherited upstream-looking variables must never open this fork's
      // production Cloud gate without the source-level test-mode capability.
      MARKD_CLOUD_OWNERSHIP: "verified",
      MARKD_CLOUD_API_BASE: "https://api.usemarkd.app",
      MARKD_CLOUD_SITE_ORIGIN: "https://usemarkd.app",
    },
  });
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
        bridgeModules: ["app", "capture", "cloud", "collections", "updates", "vault"],
        hasNodeProcess: false,
        hasRequire: false,
        hasIpcRenderer: false,
      });

    await application.evaluate(({ shell }) => {
      shell.openExternal = async (url) => {
        process.env.MARKD_TEST_OPENED_EXTERNAL = url;
      };
      delete process.env.MARKD_TEST_OPENED_EXTERNAL;
    });
    const disabledCloud = await page.evaluate(async () => Promise.all([
      window.markd!.cloud!.accountStatus(),
      window.markd!.cloud!.plansUrl(),
      window.markd!.cloud!.publishedNoteStatus("Home.md", "Home", "# Home", []),
      window.markd!.cloud!.openExternal("https://usemarkd.app/pricing"),
    ]));
    for (const result of disabledCloud) {
      expect(result).toEqual({
        ok: false,
        error: {
          kind: "CLOUD_OWNERSHIP_UNVERIFIED",
          message:
            "Cloud publishing is unavailable because this build has not verified ownership of its Cloud API and site.",
        },
      });
    }
    expect(await application.evaluate(() => process.env.MARKD_TEST_OPENED_EXTERNAL ?? null))
      .toBeNull();

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

test("quick-capture preload does not expose main-window export capabilities", async () => {
  const application = await launchMarkd();
  try {
    await application.firstWindow();
    await expect.poll(() => application.windows().length).toBe(2);
    const pages = application.windows();
    const kinds = await Promise.all(
      pages.map((page) => page.evaluate(() => window.markd?.app.windowKind)),
    );
    const quickPage = pages[kinds.indexOf("quick-capture")];
    if (!quickPage) throw new Error("Quick Capture window was not created");
    expect(
      await quickPage.evaluate(() => ({
        windowKind: window.markd?.app.windowKind,
        cloud: typeof window.markd?.cloud,
        noteExport: typeof window.markd?.vault.exportNote,
        bookmarkExport: typeof window.markd?.collections.bookmarks.export,
      })),
    ).toEqual({
      windowKind: "quick-capture",
      cloud: "undefined",
      noteExport: "undefined",
      bookmarkExport: "undefined",
    });
  } finally {
    await application.close();
  }
});

test("real Cloud Engine completes account and Published Share lifecycle", async () => {
  const scratch = await mkdtemp(join(tmpdir(), "markd-electron-cloud-"));
  const configDir = join(scratch, "config");
  const vault = join(scratch, "vault");
  await mkdir(join(vault, ".markd", "assets"), { recursive: true });
  await mkdir(configDir, { recursive: true });
  await writeFile(join(vault, "Home.md"), "# Home");
  await writeFile(
    join(configDir, "config.json"),
    JSON.stringify({ vaultPath: vault, theme: "system" }),
  );
  let publishCount = 0;
  let entryId = "";
  let title = "";
  const server = createServer(async (request, response) => {
    const path = request.url ?? "";
    const body = await new Promise<string>((resolve) => {
      let value = "";
      request.setEncoding("utf8");
      request.on("data", (chunk) => { value += chunk; });
      request.on("end", () => resolve(value));
    });
    if (path === "/v1/auth/otp/request") {
      respondJson(response, {
        challengeId: "challenge_1",
        email: "reader@example.com",
        expiresIn: 600,
        resendAfter: 30,
      });
      return;
    }
    if (path === "/v1/auth/otp/verify") {
      respondJson(response, {
        accessToken: "token_123",
        expiresAt: Date.now() + 60_000,
        user: { email: "reader@example.com", plan: "cloud" },
      });
      return;
    }
    if (path === "/v1/me") {
      respondJson(response, { user: { email: "reader@example.com", plan: "cloud" } });
      return;
    }
    if (path === "/v1/billing/portal") {
      respondJson(response, { url: `${origin()}/account` });
      return;
    }
    if (path === "/v1/publish-sessions") {
      publishCount += 1;
      const input = JSON.parse(body) as { entryId: string; title: string };
      entryId = input.entryId;
      title = input.title;
      respondJson(response, { sessionId: `publish_${publishCount}`, uploads: [] }, 201);
      return;
    }
    if (/^\/v1\/publish-sessions\/publish_\d+\/finalize$/.test(path)) {
      respondJson(response, { site: {
        id: "site_123",
        entryId,
        slug: "published-note",
        url: `${origin()}/s/published-note`,
        title,
        contentHash: "server-hash",
        publishedAt: 1,
        updatedAt: publishCount,
        pageCount: 1,
        assetCount: 0,
      } }, 201);
      return;
    }
    if (path === "/v1/sites/site_123" && request.method === "DELETE") {
      response.writeHead(204).end();
      return;
    }
    respondJson(response, { error: { code: "not_found", message: "Not found" } }, 404);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = () => {
    const address = server.address() as AddressInfo;
    return `http://127.0.0.1:${address.port}`;
  };
  const application = await launchMarkd({
    env: {
      MARKD_TEST_CONFIG_DIR: configDir,
      MARKD_CLOUD_TEST_MODE: "1",
      MARKD_CLOUD_API_BASE: origin(),
      MARKD_CLOUD_SITE_ORIGIN: origin(),
    },
  });
  try {
    const page = await markdWindow(application, "main");
    await expect.poll(() => page.evaluate(() => window.markd!.vault.startup()))
      .toEqual({ ok: true, value: expect.objectContaining({ root: await realpath(vault) }) });
    expect(await page.evaluate(() => window.markd!.cloud!.requestOtp("reader@example.com")))
      .toEqual({ ok: true, value: expect.objectContaining({ challengeId: "challenge_1" }) });
    expect(await page.evaluate(() => window.markd!.cloud!.verifyOtp("challenge_1", "123456")))
      .toEqual({ ok: true, value: { email: "reader@example.com", plan: "cloud" } });
    expect(await page.evaluate(() => window.markd!.cloud!.accountStatus()))
      .toEqual({ ok: true, value: { account: { email: "reader@example.com", plan: "cloud" } } });
    const draft = ["Home.md", "Home", "# Home", []] as const;
    expect(await page.evaluate(
      ([rel, nextTitle, content, pages]) =>
        window.markd!.cloud!.publishNote(rel, nextTitle, content, pages),
      draft,
    )).toEqual({ ok: true, value: expect.objectContaining({ id: "site_123", title: "Home" }) });
    expect(await page.evaluate(
      ([rel, nextTitle, content, pages]) =>
        window.markd!.cloud!.publishedNoteStatus(rel, nextTitle, content, pages),
      draft,
    )).toEqual({
      ok: true,
      value: expect.objectContaining({
        share: expect.objectContaining({ id: "site_123" }),
        isOutdated: false,
      }),
    });
    expect(await page.evaluate(() =>
      window.markd!.cloud!.updatePublishedNote("Home.md", "Updated", "# Updated", []),
    )).toEqual({ ok: true, value: expect.objectContaining({ title: "Updated" }) });
    const portal = await page.evaluate(() => window.markd!.cloud!.billingPortalUrl());
    expect(portal).toEqual({ ok: true, value: `${origin()}/account` });
    await application.evaluate(({ shell }) => {
      shell.openExternal = async (url) => {
        process.env.MARKD_TEST_OPENED_EXTERNAL = url;
      };
    });
    expect(await page.evaluate(
      (url) => window.markd!.cloud!.openExternal(url),
      `${origin()}/account`,
    )).toEqual({ ok: true, value: null });
    expect(await application.evaluate(() => process.env.MARKD_TEST_OPENED_EXTERNAL))
      .toBe(`${origin()}/account`);
    expect(await page.evaluate(() => window.markd!.cloud!.revokePublishedNote("Home.md")))
      .toEqual({ ok: true, value: null });
    expect(await page.evaluate(() => window.markd!.cloud!.isNotePublished("Home.md")))
      .toEqual({ ok: true, value: false });
  } finally {
    await application.close();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve()),
    );
    await rm(scratch, { recursive: true, force: true });
  }
});

function respondJson(
  response: import("node:http").ServerResponse,
  value: unknown,
  status = 200,
): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
}

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
      await page.evaluate(() => window.markd!.vault.writeNote("Untitled.md", "saved", "")),
    ).toEqual({ ok: true, value: "saved" });
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
    const page = await markdWindow(first, "main");
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
    const page = await markdWindow(restarted, "main");
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

test("secure asset protocol and native exports stay inside canonical paths", async () => {
  const scratch = await mkdtemp(join(tmpdir(), "markd-electron-content-"));
  const configDir = join(scratch, "config");
  const vault = join(scratch, "vault");
  const noteExport = join(scratch, "Draft export.md");
  const bookmarkExport = join(scratch, "Bookmarks export.md");
  await mkdir(configDir, { recursive: true });
  await mkdir(vault, { recursive: true });
  await writeFile(join(vault, "Draft.md"), "stale disk body");
  await writeFile(
    join(configDir, "config.json"),
    JSON.stringify({ vaultPath: vault, theme: "system" }),
  );
  const application = await launchMarkd({ env: { MARKD_TEST_CONFIG_DIR: configDir } });
  try {
    const page = await application.firstWindow();
    await expect.poll(() => page.evaluate(() => window.markd!.vault.startup())).toEqual({
      ok: true,
      value: expect.objectContaining({ root: await realpath(vault) }),
    });

    const png =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
    const saved = await page.evaluate((data) => window.markd!.vault.assets.save(data, "png"), png);
    expect(saved).toEqual({ ok: true, value: expect.stringMatching(/^\.markd\/assets\//) });
    if (!saved.ok) throw new Error(saved.error.message);
    expect(await readFile(join(vault, saved.value))).toEqual(
      Buffer.from(png.slice(png.indexOf(",") + 1), "base64"),
    );
    expect(await page.evaluate(async (rel) => {
      const url = window.markd!.vault.assets.url(rel);
      if (!url) return null;
      const response = await fetch(url);
      const image = new Image();
      const loaded = new Promise<boolean>((resolve) => {
        image.onload = () => resolve(true);
        image.onerror = () => resolve(false);
      });
      image.src = url;
      document.body.append(image);
      return {
        status: response.status,
        type: response.headers.get("content-type"),
        size: (await response.arrayBuffer()).byteLength,
        loaded: await loaded,
      };
    }, saved.value)).toEqual({ status: 200, type: "image/png", size: 68, loaded: true });

    await application.evaluate(({ dialog }, paths) => {
      const destinations = [...paths];
      dialog.showSaveDialog = async () => ({
        canceled: false,
        filePath: destinations.shift(),
      });
    }, [noteExport, bookmarkExport]);
    expect(await page.evaluate(() =>
      window.markd!.vault.exportNote("Draft.md", "live editor body"),
    )).toEqual({ ok: true, value: join(await realpath(scratch), "Draft export.md") });
    expect(await readFile(noteExport, "utf8")).toBe("live editor body");

    await page.evaluate(() => window.markd!.collections.bookmarks.create("example.com", ["read"]));
    expect(await page.evaluate(() => window.markd!.collections.bookmarks.export())).toEqual({
      ok: true,
      value: join(await realpath(scratch), "Bookmarks export.md"),
    });
    expect(await readFile(bookmarkExport, "utf8")).toContain(
      "- [example.com](https://example.com) — #read",
    );

    const outside = join(scratch, "outside.png");
    const escape = join(vault, ".markd", "assets", "escape.png");
    await writeFile(outside, "outside");
    await symlink(outside, escape);
    expect(await page.evaluate(() => ({
      traversalUrl: window.markd!.vault.assets.url("../outside.png"),
      symlinkUrl: window.markd!.vault.assets.url(".markd/assets/escape.png"),
    }))).toEqual({ traversalUrl: null, symlinkUrl: "markd-asset://vault/escape.png" });
    expect(await page.evaluate(async () =>
      fetch("markd-asset://vault/..%2Foutside.png").then((response) => response.status),
    )).toBe(400);
    expect(await page.evaluate(async () =>
      fetch("markd-asset://vault/escape.png").then((response) => response.status),
    )).toBe(400);

    const outsideExport = join(scratch, "outside.md");
    const exportAlias = join(scratch, "export-alias.md");
    await writeFile(outsideExport, "keep");
    await symlink(outsideExport, exportAlias);
    await application.evaluate(({ dialog }, path) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
    }, exportAlias);
    expect(await page.evaluate(() =>
      window.markd!.vault.exportNote("Draft.md", "overwrite"),
    )).toEqual({
      ok: false,
      error: expect.objectContaining({ kind: "INVALID_PATH" }),
    });
    expect(await readFile(outsideExport, "utf8")).toBe("keep");
  } finally {
    await application.close();
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

    const concurrent = await mainPage.evaluate(async () => {
      const appended = window.markd!.capture.append("Inbox.md", "captured during save");
      const saved = window.markd!.vault.writeNote(
        "Inbox.md",
        "edited thought",
        "first thought\nsecond thought",
      );
      return Promise.all([appended, saved]);
    });
    expect(concurrent).toEqual([
      { ok: true, value: expect.objectContaining({ rel: "Inbox.md" }) },
      { ok: true, value: "edited thought\ncaptured during save" },
    ]);
    expect(await readFile(join(vault, "Inbox.md"), "utf8")).toBe(
      "edited thought\ncaptured during save",
    );

    const autosaves = await mainPage.evaluate(() =>
      Promise.all([
        window.markd!.vault.writeNote(
          "Inbox.md",
          "first autosave\ncaptured during save",
          "edited thought\ncaptured during save",
        ),
        window.markd!.vault.writeNote(
          "Inbox.md",
          "second autosave\ncaptured during save",
          "first autosave\ncaptured during save",
        ),
      ]),
    );
    expect(autosaves).toEqual([
      { ok: true, value: "first autosave\ncaptured during save" },
      { ok: true, value: "second autosave\ncaptured during save" },
    ]);
    expect(await readFile(join(vault, "Inbox.md"), "utf8")).toBe(
      "second autosave\ncaptured during save",
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
      "second autosave\ncaptured during save\nafter restart",
    );
  } finally {
    await application.close();
    await rm(scratch, { recursive: true, force: true });
  }
});

test("Quick Capture clears a failed draft only after explicit close", async () => {
  const scratch = await mkdtemp(join(tmpdir(), "markd-electron-capture-failure-"));
  const application = await launchMarkd({
    env: {
      MARKD_TEST_CONFIG_DIR: join(scratch, "config"),
      MARKD_TEST_QUICK_CAPTURE_ACCELERATOR: "F24",
    },
  });
  try {
    const mainPage = await markdWindow(application, "main");
    const capturePage = await markdWindow(application, "quick-capture");
    await mainPage.evaluate(() => window.markd!.capture.open());
    await capturePage.getByRole("button", { name: "Append to note" }).click();
    await capturePage.getByPlaceholder(/Note path/).fill("Inbox.md");
    await capturePage
      .getByPlaceholder("Write something worth keeping…")
      .fill("kept draft");
    await capturePage.getByRole("button", { name: "Append capture" }).click();
    await expect(capturePage.getByRole("alert")).toContainText(
      "No Vault is open",
    );

    await mainPage.evaluate(() => window.markd!.capture.open());
    await expect(capturePage.getByPlaceholder(/Note path/)).toHaveValue("Inbox.md");
    await expect(
      capturePage.getByPlaceholder("Write something worth keeping…"),
    ).toHaveValue("kept draft");
    await expect(capturePage.getByRole("alert")).toBeVisible();

    await capturePage.getByRole("button", { name: "Close Quick Capture" }).click();
    await mainPage.evaluate(() => window.markd!.capture.open());
    await expect(capturePage.getByRole("alert")).toHaveCount(0);
    await expect(capturePage.getByPlaceholder("Title")).toHaveValue("");
    await expect(
      capturePage.getByPlaceholder("Write something worth keeping…"),
    ).toHaveValue("");
  } finally {
    await application.close();
    await rm(scratch, { recursive: true, force: true });
  }
});
