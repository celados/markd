import { mkdtemp, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { CloudEngine, CloudEngineError } from "../electron/cloud-engine";
import { resolveCloudConfig } from "../electron/cloud-config";

const verified = resolveCloudConfig({
  MARKD_CLOUD_TEST_MODE: "1",
  MARKD_CLOUD_API_BASE: "http://127.0.0.1:3001",
  MARKD_CLOUD_SITE_ORIGIN: "http://127.0.0.1:3002",
});

describe("Cloud Engine", () => {
  test("returns an explicit ownership failure before production Cloud is configured", async () => {
    let networkCalls = 0;
    const fetch: typeof globalThis.fetch = async () => {
      networkCalls += 1;
      throw new Error("network must stay closed");
    };
    const engine = new CloudEngine(
      "/tmp/markd-cloud-disabled",
      () => "/tmp/vault",
      resolveCloudConfig({
        MARKD_CLOUD_API_BASE: "https://api.usemarkd.app",
        MARKD_CLOUD_SITE_ORIGIN: "https://usemarkd.app",
      }),
      fetch,
    );
    await expect(engine.accountStatus()).rejects.toMatchObject({
      name: "CloudEngineError",
      kind: "CLOUD_OWNERSHIP_UNVERIFIED",
    });
    await expect(engine.plansUrl()).rejects.toMatchObject({
      kind: "CLOUD_OWNERSHIP_UNVERIFIED",
    });
    await expect(engine.publish({
      rel: "Home.md",
      title: "Home",
      content: "# Home",
      pages: [],
    })).rejects.toMatchObject({ kind: "CLOUD_OWNERSHIP_UNVERIFIED" });
    expect(networkCalls).toBe(0);
  });

  test("persists, refreshes, and revokes an account session with tagged failures", async () => {
    const scratch = await mkdtemp(join(tmpdir(), "markd-cloud-account-"));
    const requests: Array<{ url: string; method: string; authorization: string | null }> = [];
    const fetch: typeof globalThis.fetch = async (input, init) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      requests.push({
        url,
        method: init?.method ?? "GET",
        authorization: headers.get("authorization"),
      });
      if (url.endsWith("/v1/auth/otp/request")) {
        return Response.json({
          challengeId: "challenge_1",
          email: "reader@example.com",
          expiresIn: 600,
          resendAfter: 30,
        });
      }
      if (url.endsWith("/v1/auth/otp/verify")) {
        return Response.json({
          accessToken: "token_123",
          expiresAt: Date.now() + 60_000,
          user: { email: "reader@example.com", plan: "free" },
        });
      }
      if (url.endsWith("/v1/me")) {
        return Response.json({ user: { email: "reader@example.com", plan: "cloud" } });
      }
      if (url.endsWith("/v1/session")) return new Response(null, { status: 204 });
      return Response.json({ error: { code: "missing", message: "Missing" } }, { status: 404 });
    };
    const engine = new CloudEngine(scratch, () => join(scratch, "vault"), verified, fetch);

    await expect(engine.requestOtp("reader@example.com")).resolves.toMatchObject({
      challengeId: "challenge_1",
    });
    await expect(engine.verifyOtp("challenge_1", "123456")).resolves.toEqual({
      email: "reader@example.com",
      plan: "free",
    });
    await expect(engine.accountStatus()).resolves.toEqual({
      account: { email: "reader@example.com", plan: "cloud" },
    });
    expect(JSON.parse(await readFile(join(scratch, "cloud-session.json"), "utf8")))
      .toMatchObject({ accessToken: "token_123", account: { plan: "cloud" } });
    await expect(engine.signOut()).resolves.toBeUndefined();
    await expect(readFile(join(scratch, "cloud-session.json"), "utf8"))
      .rejects.toMatchObject({ code: "ENOENT" });
    expect(requests.at(-1)).toEqual({
      url: "http://127.0.0.1:3001/v1/session",
      method: "DELETE",
      authorization: "Bearer token_123",
    });
  });

  test("publishes, updates, and revokes a Note without storing a Cloud copy", async () => {
    const scratch = await mkdtemp(join(tmpdir(), "markd-cloud-publish-"));
    const config = join(scratch, "config");
    const vault = join(scratch, "vault");
    await mkdir(join(vault, ".markd", "assets"), { recursive: true });
    await mkdir(config, { recursive: true });
    await writeFile(join(vault, "Home.md"), "# Home\n\nDraft on disk");
    await writeFile(join(vault, "Linked.md"), "# Linked");
    await writeFile(
      join(vault, ".markd", "assets", "pixel.png"),
      Buffer.from("89504e470d0a1a0a", "hex"),
    );
    await writeFile(join(config, "cloud-session.json"), JSON.stringify({
      accessToken: "token_123",
      expiresAt: Date.now() + 60_000,
      account: { email: "reader@example.com", plan: "cloud" },
    }));
    let publishNumber = 0;
    const manifests: unknown[] = [];
    const fetch: typeof globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.endsWith("/v1/me")) {
        return Response.json({ user: { email: "reader@example.com", plan: "cloud" } });
      }
      if (url.endsWith("/v1/publish-sessions")) {
        publishNumber += 1;
        manifests.push(JSON.parse(String(init?.body)).manifest);
        return Response.json({ sessionId: `publish_${publishNumber}`, uploads: [] }, { status: 201 });
      }
      if (url.includes("/finalize")) {
        const manifest = manifests.at(-1) as { rootEntryId: string; pages: unknown[] };
        return Response.json({ site: {
          id: "site_123",
          entryId: manifest.rootEntryId,
          slug: "public-slug",
          url: "http://127.0.0.1:3002/s/public-slug",
          title: publishNumber === 1 ? "Home" : "Home updated",
          contentHash: "server-hash",
          publishedAt: 1,
          updatedAt: publishNumber,
          pageCount: manifest.pages.length,
          assetCount: 0,
        } }, { status: 201 });
      }
      if (url.endsWith("/v1/sites/site_123")) return new Response(null, { status: 204 });
      throw new Error(`Unexpected request: ${url}`);
    };
    const canonicalVault = await realpath(vault);
    const engine = new CloudEngine(config, () => canonicalVault, verified, fetch);
    const draft = {
      rel: "Home.md",
      title: "Home",
      content: "# Home\n\nDraft from editor\n\n![pixel](.markd/assets/pixel.png)",
      pages: [{ rel: "Linked.md", path: "linked", title: "Linked", markdown: "# Linked" }],
    };

    const published = await engine.publish(draft);
    expect(published).toMatchObject({ id: "site_123", pageCount: 2 });
    expect((manifests[0] as { objects: Array<{ kind: string }> }).objects)
      .toEqual(expect.arrayContaining([{ kind: "asset", hash: expect.any(String), contentType: "image/png", size: 8 }]));
    await expect(engine.status(draft)).resolves.toMatchObject({
      share: { id: "site_123" },
      isOutdated: false,
    });
    const updated = await engine.update({ ...draft, title: "Home updated", content: "# Changed" });
    expect(updated).toMatchObject({ title: "Home updated" });
    const metadata = await readFile(join(vault, ".markd", "cloud.json"), "utf8");
    expect(metadata).not.toContain("Draft from editor");
    expect(metadata).not.toContain("# Changed");
    await expect(engine.revoke("Home.md")).resolves.toBeUndefined();
    await expect(engine.isPublished("Home.md")).resolves.toBe(false);
  });

  test("rejects remote errors and untrusted billing URLs as tagged data", async () => {
    const scratch = await mkdtemp(join(tmpdir(), "markd-cloud-errors-"));
    await mkdir(scratch, { recursive: true });
    await writeFile(join(scratch, "cloud-session.json"), JSON.stringify({
      accessToken: "token_123",
      expiresAt: Date.now() + 60_000,
      account: { email: "reader@example.com", plan: "free" },
    }));
    const remoteFailure: typeof globalThis.fetch = async () => Response.json({
      error: { code: "cloud_subscription_required", message: "Upgrade first." },
    }, { status: 402 });
    await expect(
      new CloudEngine(scratch, () => scratch, verified, remoteFailure).plansUrl(),
    ).rejects.toMatchObject({
      kind: "cloud_subscription_required",
      message: "Upgrade first.",
    });

    const untrusted: typeof globalThis.fetch = async () =>
      Response.json({ url: "https://evil.invalid/account" });
    await expect(
      new CloudEngine(scratch, () => scratch, verified, untrusted).portalUrl(),
    ).rejects.toEqual(expect.objectContaining<Partial<CloudEngineError>>({
      kind: "CLOUD_UNTRUSTED_URL",
    }));
  });

  test("rejects the complete upload plan before sending any object bytes", async () => {
    const scratch = await mkdtemp(join(tmpdir(), "markd-cloud-upload-trust-"));
    const vault = join(scratch, "vault");
    await mkdir(join(vault, ".markd", "assets"), { recursive: true });
    await writeFile(join(vault, "Home.md"), "# Home");
    await writeFile(join(scratch, "cloud-session.json"), JSON.stringify({
      accessToken: "token_123",
      expiresAt: Date.now() + 60_000,
      account: { email: "reader@example.com", plan: "cloud" },
    }));
    let objectWrites = 0;
    const fetch: typeof globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.endsWith("/v1/publish-sessions")) {
        const body = JSON.parse(String(init?.body)) as {
          manifest: { objects: Array<{ hash: string }> };
        };
        const hash = body.manifest.objects[0]!.hash;
        return Response.json({
          sessionId: "publish_1",
          uploads: [
            { hash, url: "https://objects.example.test/first", headers: {} },
            { hash, url: "http://evil.invalid/second", headers: {} },
          ],
        }, { status: 201 });
      }
      if (init?.method === "PUT") {
        objectWrites += 1;
        return new Response(null, { status: 200 });
      }
      throw new Error(`Unexpected request: ${url}`);
    };
    const canonicalVault = await realpath(vault);
    const engine = new CloudEngine(scratch, () => canonicalVault, verified, fetch);
    await expect(engine.publish({
      rel: "Home.md",
      title: "Home",
      content: "# Home",
      pages: [],
    })).rejects.toMatchObject({ kind: "CLOUD_UNTRUSTED_UPLOAD_URL" });
    expect(objectWrites).toBe(0);
  });

  test("remote sign-out failure still removes the authoritative local session", async () => {
    const scratch = await mkdtemp(join(tmpdir(), "markd-cloud-signout-"));
    await writeFile(join(scratch, "cloud-session.json"), JSON.stringify({
      accessToken: "token_123",
      expiresAt: Date.now() + 60_000,
      account: { email: "reader@example.com", plan: "cloud" },
    }));
    const fetch: typeof globalThis.fetch = async () => Response.json({
      error: { code: "remote_unavailable", message: "Remote sign-out failed." },
    }, { status: 503 });
    const engine = new CloudEngine(scratch, () => scratch, verified, fetch);

    await expect(engine.signOut()).rejects.toMatchObject({
      kind: "cloud",
      message: "Remote sign-out failed.",
      details: expect.objectContaining({ localSignedOut: true }),
    });
    await expect(engine.accountStatus()).resolves.toEqual({ account: null });
  });
});
