import { expect, test } from "@playwright/test";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { promisify } from "node:util";
import { launchMarkd, markdWindow } from "./launch-markd";
import { runSecureContentJourney } from "../shared/secure-content-journey";

const execFileAsync = promisify(execFile);

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

test("a pre-Vault index subscription activates on the first replacement", async () => {
  const scratch = await mkdtemp(join(tmpdir(), "markd-electron-pending-index-"));
  const configDir = join(scratch, "config");
  const vault = join(scratch, "vault");
  await mkdir(configDir);
  await mkdir(vault);
  await writeFile(join(vault, "Existing.md"), "existing");
  const application = await launchMarkd({
    env: { MARKD_TEST_CONFIG_DIR: configDir },
  });
  try {
    const page = await markdWindow(application, "main");
    await page.evaluate(async () => {
      const state = window as typeof window & {
        __pendingIndexEvents?: unknown[];
        __disposedIndexEvents?: number;
      };
      state.__pendingIndexEvents = [];
      state.__disposedIndexEvents = 0;
      window.markd!.vault.onIndexEvent((event) => {
        state.__pendingIndexEvents!.push(event);
      });
      const dispose = window.markd!.vault.onIndexEvent(() => {
        state.__disposedIndexEvents! += 1;
      });
      dispose();
      // This request is a barrier after both initial synchronize calls return
      // null, proving the listeners were registered before any Vault existed.
      await window.markd!.vault.snapshot();
    });
    await application.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
    }, vault);

    await page.evaluate(() => window.markd!.vault.choose());
    await expect.poll(() => page.evaluate(() => {
      const events = (window as typeof window & {
        __pendingIndexEvents?: Array<{ kind: string }>;
      }).__pendingIndexEvents ?? [];
      return events.map((event) => event.kind);
    })).toContain("replacement");

    await application.evaluate(({ shell }) => {
      shell.openExternal = async (url) => {
        process.env.MARKD_TEST_OPENED_WEB = url;
      };
      shell.showItemInFolder = (path) => {
        process.env.MARKD_TEST_REVEALED_PATH = path;
      };
    });
    expect(await page.evaluate(() => window.markd!.app.openWebUrl("https://example.com/docs")))
      .toEqual({ ok: true, value: null });
    expect(await page.evaluate(() => window.markd!.app.revealVaultEntry("Existing.md")))
      .toEqual({ ok: true, value: null });
    expect(await application.evaluate(() => ({
      opened: process.env.MARKD_TEST_OPENED_WEB,
      revealed: process.env.MARKD_TEST_REVEALED_PATH,
    }))).toEqual({
      opened: "https://example.com/docs",
      revealed: join(await realpath(vault), "Existing.md"),
    });
    expect(await page.evaluate(() => window.markd!.app.revealVaultEntry("../Outside.md")))
      .toEqual(expect.objectContaining({ ok: false, error: expect.objectContaining({ kind: "INVALID_PATH" }) }));

    await writeFile(join(vault, "Later.md"), "later");
    await expect(page.getByRole("treeitem", { name: "Later.md" })).toBeVisible();
    await rm(join(vault, "Later.md"));
    await expect(page.getByRole("treeitem", { name: "Later.md" })).toHaveCount(0);
    expect(await page.evaluate(() => {
      const state = window as typeof window & {
        __pendingIndexEvents?: Array<{
          kind: string;
          changes?: Array<{
            kind: string;
            rel?: string;
            entry?: { rel: string };
          }>;
        }>;
        __disposedIndexEvents?: number;
      };
      const events = state.__pendingIndexEvents ?? [];
      return {
        first: events[0]?.kind,
        changes: events.flatMap((event) => event.changes?.map((change) =>
          `${change.kind}:${change.rel ?? change.entry?.rel ?? ""}`,
        ) ?? []),
        disposed: state.__disposedIndexEvents,
      };
    })).toEqual({
      first: "replacement",
      changes: expect.arrayContaining([
        expect.stringMatching(/^(created|modified):Later\.md$/),
        "removed:Later.md",
      ]),
      disposed: 0,
    });
  } finally {
    await application.close();
    await rm(scratch, { recursive: true, force: true });
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
        updates: typeof window.markd?.updates,
        noteExport: typeof window.markd?.vault.exportNote,
        bookmarkExport: typeof window.markd?.collections.bookmarks.export,
      })),
    ).toEqual({
      windowKind: "quick-capture",
      cloud: "undefined",
      updates: "undefined",
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
  await mkdir(join(chosenVault, "projects"), { recursive: true });
  await mkdir(join(chosenVault, "node_modules", "package"), { recursive: true });
  await writeFile(join(chosenVault, "Existing.md"), "existing");
  await writeFile(join(chosenVault, "projects", ".gitignore"), "*.md\n!Keep.md\n");
  await writeFile(join(chosenVault, "projects", "Keep.md"), "keep");
  await writeFile(join(chosenVault, "projects", "Drop.md"), "drop");
  await writeFile(
    join(chosenVault, "node_modules", "package", "Invisible.md"),
    "dependency",
  );
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
    await page.getByRole("treeitem", { name: "projects" }).click();
    await expect(page.getByRole("treeitem", { name: "Keep.md" })).toBeVisible();
    await expect(page.getByRole("treeitem", { name: "Drop.md" })).toHaveCount(0);
    await expect(page.getByRole("treeitem", { name: "Invisible.md" })).toHaveCount(0);
    expect(await readFile(join(chosenVault, ".ignore"), "utf8")).toContain(
      "# BEGIN MARKD MANAGED IGNORE",
    );

    await page.evaluate(() => {
      const state = window as typeof window & { __liveIndexEvents?: unknown[] };
      state.__liveIndexEvents = [];
      window.markd!.vault.onIndexEvent((event) => state.__liveIndexEvents!.push(event));
    });
    await writeFile(join(chosenVault, "Watched.md"), "external");
    await expect.poll(() => page.evaluate(() =>
      (window as typeof window & { __liveIndexEvents?: Array<{ kind: string }> })
        .__liveIndexEvents?.map((event) => event.kind),
    )).toContain("changes");
    await expect(page.getByRole("treeitem", { name: "Watched.md" })).toBeVisible();
    await page.evaluate(() => {
      const state = window as typeof window & {
        __lateIndexBaseline?: { kind: string; paths: string[] };
        __lateIndexKinds?: string[];
      };
      state.__lateIndexKinds = [];
      window.markd!.vault.onIndexEvent((event) => {
        state.__lateIndexKinds!.push(event.kind);
        if (state.__lateIndexBaseline) return;
        const paths: string[] = [];
        if (event.kind === "replacement") {
          const visit = (nodes: typeof event.snapshot.tree) => {
            for (const node of nodes) {
              paths.push(node.rel);
              if (node.children) visit(node.children);
            }
          };
          visit(event.snapshot.tree);
        }
        state.__lateIndexBaseline = { kind: event.kind, paths };
      });
    });
    await expect.poll(() => page.evaluate(() =>
      (window as typeof window & {
        __lateIndexBaseline?: { kind: string; paths: string[] };
      }).__lateIndexBaseline,
    )).toEqual({
      kind: "replacement",
      paths: expect.arrayContaining(["Existing.md", "Watched.md"]),
    });
    await writeFile(join(chosenVault, "After Late.md"), "after baseline");
    await expect.poll(() => page.evaluate(() =>
      (window as typeof window & { __lateIndexKinds?: string[] }).__lateIndexKinds,
    )).toEqual(["replacement", "changes"]);
    await rm(join(chosenVault, "Watched.md"));
    await expect(page.getByRole("treeitem", { name: "Watched.md" })).toHaveCount(0);


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
        tree: expect.arrayContaining([
          expect.objectContaining({ rel: "Existing.md", kind: "note" }),
        ]),
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

    const existing = page.getByRole("tree", { name: "Notes", exact: true })
      .getByRole("treeitem", { name: "Existing.md" });
    await existing.click({ button: "right" });
    await page.getByRole("menuitem", { name: "Pin note" }).click();
    const pinnedTree = page.getByRole("tree", { name: "Pinned notes and folders" });
    await expect(pinnedTree.getByRole("treeitem", { name: "Existing.md" })).toBeVisible();
    await rm(join(chosenVault, "Existing.md"));
    await expect.poll(() => page.evaluate(() => {
      const events = (window as typeof window & {
        __liveIndexEvents?: Array<{
          kind: string;
          changes?: Array<{ kind: string; rel?: string }>;
        }>;
      }).__liveIndexEvents ?? [];
      return events.flatMap((event) => event.changes?.map((change) =>
        `${change.kind}:${change.rel ?? ""}`,
      ) ?? []);
    })).toContain("removed:Existing.md");
    await expect(existing).toHaveCount(0);
    await expect(
      pinnedTree.getByRole("treeitem", { name: /Existing\.md Missing/ }),
    ).toHaveAttribute("data-status", "stale");

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

test("dirty Note flushes to the old Vault before a real Vault switch", async () => {
  const scratch = await mkdtemp(join(tmpdir(), "markd-electron-switch-flush-"));
  const configDir = join(scratch, "config");
  const firstVault = join(scratch, "first");
  const secondVault = join(scratch, "second");
  await mkdir(configDir);
  await mkdir(firstVault);
  await mkdir(secondVault);
  await writeFile(join(firstVault, "Existing.md"), "# Existing");
  await writeFile(
    join(configDir, "config.json"),
    JSON.stringify({ vaultPath: firstVault, theme: "system" }),
  );
  const application = await launchMarkd({ env: { MARKD_TEST_CONFIG_DIR: configDir } });
  try {
    const page = await markdWindow(application, "main");
    await page.getByRole("treeitem", { name: "Existing.md" }).click();
    const editor = page.locator('[data-note-editor="active"] .ProseMirror');
    await editor.click();
    await page.keyboard.press("End");
    await page.keyboard.type(" dirty before switch");
    await application.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
    }, secondVault);
    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByRole("button", { name: "Change" }).click();

    await expect.poll(() => page.evaluate(() => window.markd!.vault.snapshot()))
      .toEqual({
        ok: true,
        value: expect.objectContaining({ root: await realpath(secondVault) }),
      });
    expect(await readFile(join(firstVault, "Existing.md"), "utf8"))
      .toContain("dirty before switch");
    await expect(readFile(join(secondVault, "Existing.md"), "utf8")).rejects.toEqual(
      expect.objectContaining({ code: "ENOENT" }),
    );
  } finally {
    await application.close();
    await rm(scratch, { recursive: true, force: true });
  }
});

test("failed dirty flush prevents the real Vault dialog and switch", async () => {
  const scratch = await mkdtemp(join(tmpdir(), "markd-electron-switch-conflict-"));
  const configDir = join(scratch, "config");
  const firstVault = join(scratch, "first");
  const secondVault = join(scratch, "second");
  await mkdir(configDir);
  await mkdir(firstVault);
  await mkdir(secondVault);
  await writeFile(join(firstVault, "Existing.md"), "# Existing");
  await writeFile(
    join(configDir, "config.json"),
    JSON.stringify({ vaultPath: firstVault, theme: "system" }),
  );
  const application = await launchMarkd({ env: { MARKD_TEST_CONFIG_DIR: configDir } });
  try {
    const page = await markdWindow(application, "main");
    await page.getByRole("treeitem", { name: "Existing.md" }).click();
    const editor = page.locator('[data-note-editor="active"] .ProseMirror');
    await editor.click();
    await page.keyboard.press("End");
    await page.keyboard.type(" conflicting draft");
    await writeFile(join(firstVault, "Existing.md"), "# External conflict");
    await application.evaluate(({ dialog }, path) => {
      process.env.MARKD_TEST_SWITCH_DIALOG_CALLS = "0";
      dialog.showOpenDialog = async () => {
        process.env.MARKD_TEST_SWITCH_DIALOG_CALLS = String(
          Number(process.env.MARKD_TEST_SWITCH_DIALOG_CALLS) + 1,
        );
        return { canceled: false, filePaths: [path] };
      };
    }, secondVault);
    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByRole("button", { name: "Change" }).click();

    await expect.poll(() => application.evaluate(() =>
      process.env.MARKD_TEST_SWITCH_DIALOG_CALLS,
    )).toBe("0");
    expect(await page.evaluate(() => window.markd!.vault.snapshot())).toEqual({
      ok: true,
      value: expect.objectContaining({ root: await realpath(firstVault) }),
    });
    expect(await readFile(join(firstVault, "Existing.md"), "utf8"))
      .toBe("# External conflict");
    await page.getByRole("button", { name: "Close settings" }).click();
    await expect(editor).toContainText("conflicting draft");
    await expect(page.getByRole("tab", { name: /Existing/ })).toBeVisible();
  } finally {
    await application.close();
    await rm(scratch, { recursive: true, force: true });
  }
});

test("real utility owns ignore-correct initial scan, watch, and policy rescan", async () => {
  const scratch = await mkdtemp(join(tmpdir(), "markd-electron-index-"));
  const configDir = join(scratch, "config");
  const vault = join(scratch, "vault");
  const gitHome = join(scratch, "home");
  const globalIgnore = join(scratch, "global-ignore");
  await mkdir(configDir, { recursive: true });
  await mkdir(join(vault, "projects"), { recursive: true });
  await mkdir(join(vault, "Empty Folder"), { recursive: true });
  await mkdir(join(vault, "node_modules", "package"), { recursive: true });
  await mkdir(gitHome, { recursive: true });
  await execFileAsync("git", ["init", "--quiet", vault]);
  await mkdir(join(vault, ".git", "info"), { recursive: true });
  await writeFile(globalIgnore, "Global.md\nReincluded.md\n");
  await writeFile(
    join(gitHome, ".gitconfig"),
    `[core]\n\texcludesFile = ${globalIgnore}\n`,
  );
  await writeFile(join(vault, ".git", "info", "exclude"), "Info.md\n!Reincluded.md\n");
  await writeFile(join(vault, ".gitignore"), "Root.md\n");
  await writeFile(join(vault, "projects", ".gitignore"), "*.md\n!Keep.md\n");
  for (const rel of [
    "Visible.md",
    "Policy.md",
    "Global.md",
    "Reincluded.md",
    "Info.md",
    "Root.md",
    "projects/Keep.md",
    "projects/Drop.md",
    ".hidden.md",
    "node_modules/package/Invisible.md",
  ]) {
    await mkdir(join(vault, rel, ".."), { recursive: true });
    await writeFile(join(vault, rel), rel);
  }
  await writeFile(
    join(configDir, "config.json"),
    JSON.stringify({ vaultPath: vault, theme: "system" }),
  );

  const application = await launchMarkd({
    env: { MARKD_TEST_CONFIG_DIR: configDir, HOME: gitHome },
  });
  try {
    const page = await markdWindow(application, "main");
    const indexedPaths = () => page.evaluate(async () => {
      const result = await window.markd!.vault.snapshot();
      if (!result.ok) return [`ERROR:${result.error.kind}`];
      const paths: string[] = [];
      const visit = (nodes: typeof result.value.tree) => {
        for (const node of nodes) {
          paths.push(node.rel);
          if (node.children) visit(node.children);
        }
      };
      visit(result.value.tree);
      return paths.sort();
    });

    await expect.poll(indexedPaths).toEqual([
      "Empty Folder",
      "Policy.md",
      "Reincluded.md",
      "Visible.md",
      "projects",
      "projects/Keep.md",
    ]);

    await writeFile(join(vault, "External.md"), "external");
    await expect.poll(indexedPaths).toContain("External.md");
    await rm(join(vault, "External.md"));
    await expect.poll(indexedPaths).not.toContain("External.md");
    await mkdir(join(vault, "Live Empty Folder"));
    await expect.poll(indexedPaths).toContain("Live Empty Folder");
    await rm(join(vault, "Live Empty Folder"), { recursive: true });
    await expect.poll(indexedPaths).not.toContain("Live Empty Folder");

    await writeFile(globalIgnore, "Global.md\nReincluded.md\nPolicy.md\n");
    await expect.poll(indexedPaths).not.toContain("Policy.md");
    await writeFile(join(vault, "Local.md"), "local");
    await expect.poll(indexedPaths).toContain("Local.md");
    await writeFile(join(vault, ".ignore"), "Local.md\n");
    await expect.poll(indexedPaths).not.toContain("Local.md");
    await expect.poll(() => readFile(join(vault, ".ignore"), "utf8")).toContain(
      "# BEGIN MARKD MANAGED IGNORE",
    );

    await writeFile(
      join(vault, "projects", ".gitignore"),
      "*.md\n!Keep.md\n!Drop.md\n",
    );
    await expect.poll(indexedPaths).toContain("projects/Drop.md");
  } finally {
    await application.close();
    await rm(scratch, { recursive: true, force: true });
  }
});

test("real utility owns search frecency and validated backlinks", async () => {
  const scratch = await mkdtemp(join(tmpdir(), "markd-electron-search-"));
  const configDir = join(scratch, "config");
  const vault = join(scratch, "vault");
  await mkdir(join(vault, "node_modules", "package"), { recursive: true });
  await mkdir(configDir, { recursive: true });
  await writeFile(join(vault, "Content A.md"), "shared needle");
  await writeFile(join(vault, "Content B.md"), "shared needle");
  await writeFile(join(vault, "Target.md"), "# Target");
  await writeFile(
    join(vault, "Source.md"),
    [
      "---",
      "ref: '[metadata](Target.md)'",
      "---",
      "Plain Target.md text.",
      "![preview](Target.md)",
      "```md",
      "[example](Target.md)",
      "```",
      "See [the target](Target.md#details) and [[Target|its wiki alias]].",
    ].join("\n"),
  );
  await writeFile(
    join(vault, "node_modules", "package", "Ignored.md"),
    "shared needle",
  );
  await writeFile(
    join(configDir, "config.json"),
    JSON.stringify({ vaultPath: vault, theme: "system" }),
  );

  const application = await launchMarkd({ env: { MARKD_TEST_CONFIG_DIR: configDir } });
  try {
    const page = await markdWindow(application, "main");
    await expect.poll(() => page.evaluate(() => window.markd!.vault.startup()))
      .toEqual({ ok: true, value: expect.objectContaining({ root: await realpath(vault) }) });

    const searchOrder = () => page.evaluate(async () => {
      const result = await window.markd!.vault.search("shared needle", 10);
      return result.ok ? result.value.map((hit) => hit.rel) : [`ERROR:${result.error.kind}`];
    });
    await expect.poll(searchOrder).toEqual(["Content A.md", "Content B.md"]);

    // fff intentionally treats access as a secondary signal; repeat the user
    // action so it crosses the stable lexical tie-breaker without changing weights.
    expect(await page.evaluate(() => window.markd!.vault.recordSearchAccess("Content B.md")))
      .toEqual({ ok: true, value: null });
    expect(await page.evaluate(() => window.markd!.vault.recordSearchAccess("Content B.md")))
      .toEqual({ ok: true, value: null });
    await expect.poll(searchOrder).toEqual(["Content B.md", "Content A.md"]);

    expect(await page.evaluate(() => window.markd!.vault.backlinks("Target.md"))).toEqual({
      ok: true,
      value: [
        {
          sourceRel: "Source.md",
          context: "See the target and its wiki alias.",
          line: 9,
          occurrence: 0,
        },
        {
          sourceRel: "Source.md",
          context: "See the target and its wiki alias.",
          line: 9,
          occurrence: 1,
        },
      ],
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
  await runSecureContentJourney((configDir) =>
    launchMarkd({ env: { MARKD_TEST_CONFIG_DIR: configDir } }));
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

test("replacement utility publishes a full index snapshot before new changes", async () => {
  test.setTimeout(15_000);
  const scratch = await mkdtemp(join(tmpdir(), "markd-electron-index-restart-"));
  const configDir = join(scratch, "config");
  const vault = join(scratch, "vault");
  await mkdir(configDir, { recursive: true });
  await mkdir(vault, { recursive: true });
  await writeFile(join(vault, "Before.md"), "before");
  await writeFile(
    join(configDir, "config.json"),
    JSON.stringify({ vaultPath: vault, theme: "system" }),
  );
  const application = await launchMarkd({
    env: {
      MARKD_TEST_CONFIG_DIR: configDir,
      MARKD_ENGINE_READY_DELAY_MS: "400",
    },
  });
  try {
    const page = await markdWindow(application, "main");
    await page.evaluate(() => {
      const state = window as typeof window & { __indexSnapshots?: string[][] };
      state.__indexSnapshots = [];
      window.markd!.vault.onIndexEvent((event) => {
        if (event.kind !== "replacement") return;
        const paths: string[] = [];
        const visit = (nodes: typeof event.snapshot.tree) => {
          for (const node of nodes) {
            paths.push(node.rel);
            if (node.children) visit(node.children);
          }
        };
        visit(event.snapshot.tree);
        const snapshot = paths.sort();
        if (JSON.stringify(state.__indexSnapshots!.at(-1)) !== JSON.stringify(snapshot)) {
          state.__indexSnapshots!.push(snapshot);
        }
      });
    });
    await expect.poll(() => page.evaluate(() =>
      (window as typeof window & { __indexSnapshots?: string[][] }).__indexSnapshots,
    )).toEqual([["Before.md"]]);

    await page.reload();
    await expect.poll(() => page.evaluate(() => window.markd!.vault.snapshot())).toEqual({
      ok: true,
      value: expect.objectContaining({ root: await realpath(vault) }),
    });
    await page.evaluate(() => {
      const state = window as typeof window & { __indexSnapshots?: string[][] };
      state.__indexSnapshots = [];
      window.markd!.vault.onIndexEvent((event) => {
        if (event.kind !== "replacement") return;
        const paths: string[] = [];
        const visit = (nodes: typeof event.snapshot.tree) => {
          for (const node of nodes) {
            paths.push(node.rel);
            if (node.children) visit(node.children);
          }
        };
        visit(event.snapshot.tree);
        const snapshot = paths.sort();
        if (JSON.stringify(state.__indexSnapshots!.at(-1)) !== JSON.stringify(snapshot)) {
          state.__indexSnapshots!.push(snapshot);
        }
      });
    });
    await expect.poll(() => page.evaluate(() =>
      (window as typeof window & { __indexSnapshots?: string[][] }).__indexSnapshots,
    )).toEqual([["Before.md"]]);

    const firstPid = await application.evaluate(({ app }) => {
      const metric = app.getAppMetrics().find((candidate) => candidate.name === "Markd Engine");
      if (!metric) throw new Error("Markd Engine process was not registered");
      process.kill(metric.pid);
      return metric.pid;
    });
    await rm(join(vault, "Before.md"));
    await writeFile(join(vault, "After.md"), "after");

    await expect.poll(async () => {
      const metrics = await application.evaluate(({ app }) => app.getAppMetrics());
      return metrics.some(
        (candidate) => candidate.name === "Markd Engine" && candidate.pid !== firstPid,
      );
    }).toBe(true);
    await expect.poll(() => page.evaluate(() =>
      (window as typeof window & { __indexSnapshots?: string[][] }).__indexSnapshots,
    )).toEqual([["Before.md"], ["After.md"]]);
    await expect.poll(() => page.evaluate(() => window.markd!.vault.snapshot())).toEqual({
      ok: true,
      value: expect.objectContaining({
        tree: [expect.objectContaining({ rel: "After.md" })],
      }),
    });
  } finally {
    await application.close();
    await rm(scratch, { recursive: true, force: true });
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
