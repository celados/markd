import { mkdtemp, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type RequestListener, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, test } from "vitest";
import { CloudEngine, CloudEngineError } from "../electron/cloud-engine";
import { resolveCloudConfig } from "../electron/cloud-config";

const validPng =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

const verified = resolveCloudConfig({
  RIFFLE_CLOUD_TEST_MODE: "1",
  RIFFLE_CLOUD_API_BASE: "http://127.0.0.1:3001",
  RIFFLE_CLOUD_SITE_ORIGIN: "http://127.0.0.1:3002",
});

describe("Cloud Engine", () => {
  test("returns an explicit ownership failure before production Cloud is configured", async () => {
    let networkCalls = 0;
    const fetch: typeof globalThis.fetch = async () => {
      networkCalls += 1;
      throw new Error("network must stay closed");
    };
    const engine = new CloudEngine(
      "/tmp/riffle-cloud-disabled",
      () => "/tmp/vault",
      resolveCloudConfig({
        RIFFLE_CLOUD_API_BASE: "https://api.usemarkd.app",
        RIFFLE_CLOUD_SITE_ORIGIN: "https://usemarkd.app",
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
    const scratch = await mkdtemp(join(tmpdir(), "riffle-cloud-account-"));
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
    const scratch = await mkdtemp(join(tmpdir(), "riffle-cloud-publish-"));
    const config = join(scratch, "config");
    const vault = join(scratch, "vault");
    await mkdir(join(vault, ".markd", "assets"), { recursive: true });
    await mkdir(config, { recursive: true });
    await writeFile(join(vault, "Home.md"), "# Home\n\nDraft on disk");
    await writeFile(join(vault, "Linked.md"), "# Linked");
    await writeFile(
      join(vault, ".markd", "assets", "pixel.png"),
      Buffer.from(validPng, "base64"),
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
      .toEqual(expect.arrayContaining([{ kind: "asset", hash: expect.any(String), contentType: "image/png", size: Buffer.from(validPng, "base64").byteLength }]));
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
    const scratch = await mkdtemp(join(tmpdir(), "riffle-cloud-errors-"));
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

  test("does not redirect a control API request carrying authorization", async () => {
    let redirectedRequests = 0;
    const target = await listen((request, response) => {
      redirectedRequests += 1;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ user: { email: "stolen@example.com", plan: "cloud" } }));
    });
    let sourceAuthorization: string | undefined;
    const source = await listen((request, response) => {
      sourceAuthorization = request.headers.authorization;
      response.writeHead(307, { location: `${target.origin}/stolen` });
      response.end();
    });
    const scratch = await mkdtemp(join(tmpdir(), "riffle-cloud-control-redirect-"));
    await writeFile(join(scratch, "cloud-session.json"), JSON.stringify({
      accessToken: "token_123",
      expiresAt: Date.now() + 60_000,
      account: { email: "reader@example.com", plan: "cloud" },
    }));
    const config = resolveCloudConfig({
      RIFFLE_CLOUD_TEST_MODE: "1",
      RIFFLE_CLOUD_API_BASE: source.origin,
      RIFFLE_CLOUD_SITE_ORIGIN: source.origin,
    });

    try {
      await expect(
        new CloudEngine(scratch, () => scratch, config).accountStatus(),
      ).rejects.toMatchObject({ kind: "network" });
      expect(sourceAuthorization).toBe("Bearer token_123");
      expect(redirectedRequests).toBe(0);
    } finally {
      await Promise.all([closeServer(source.server), closeServer(target.server)]);
    }
  });

  test("rejects the complete upload plan before sending any object bytes", async () => {
    const scratch = await mkdtemp(join(tmpdir(), "riffle-cloud-upload-trust-"));
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

  test("does not redirect an object PUT carrying Note bytes", async () => {
    let redirectedPuts = 0;
    const target = await listen((request, response) => {
      if (request.method === "PUT") redirectedPuts += 1;
      response.writeHead(200).end();
    });
    let initialPuts = 0;
    const upload = await listen((request, response) => {
      if (request.method === "PUT") initialPuts += 1;
      response.writeHead(307, { location: `${target.origin}/stolen-object` });
      response.end();
    });
    let api: Awaited<ReturnType<typeof listen>> | undefined;
    const scratch = await mkdtemp(join(tmpdir(), "riffle-cloud-upload-redirect-"));
    const vault = join(scratch, "vault");
    await mkdir(join(vault, ".markd", "assets"), { recursive: true });
    await writeFile(join(vault, "Home.md"), "# Home");
    await writeFile(join(scratch, "cloud-session.json"), JSON.stringify({
      accessToken: "token_123",
      expiresAt: Date.now() + 60_000,
      account: { email: "reader@example.com", plan: "cloud" },
    }));

    try {
      api = await listen(async (request, response) => {
        if (request.url !== "/v1/publish-sessions") {
          response.writeHead(500).end();
          return;
        }
        const input = JSON.parse(await requestBody(request)) as {
          manifest: { objects: Array<{ hash: string }> };
        };
        respondJson(response, {
          sessionId: "publish_1",
          uploads: [{
            hash: input.manifest.objects[0]!.hash,
            url: `${upload.origin}/object`,
            headers: {},
          }],
        }, 201);
      });
      const config = resolveCloudConfig({
        RIFFLE_CLOUD_TEST_MODE: "1",
        RIFFLE_CLOUD_API_BASE: api.origin,
        RIFFLE_CLOUD_SITE_ORIGIN: api.origin,
      });
      const canonicalVault = await realpath(vault);
      await expect(
        new CloudEngine(scratch, () => canonicalVault, config).publish({
          rel: "Home.md",
          title: "Home",
          content: "# Private Note",
          pages: [],
        }),
      ).rejects.toMatchObject({ kind: "network" });
      expect(initialPuts).toBe(1);
      expect(redirectedPuts).toBe(0);
    } finally {
      await Promise.all([
        ...(api ? [closeServer(api.server)] : []),
        closeServer(upload.server),
        closeServer(target.server),
      ]);
    }
  });

  test("rejects publish assets that the save and protocol contract reject", async () => {
    const scratch = await mkdtemp(join(tmpdir(), "riffle-cloud-invalid-asset-"));
    const vault = join(scratch, "vault");
    await mkdir(join(vault, ".markd", "assets"), { recursive: true });
    await writeFile(join(vault, "Home.md"), "# Home");
    await writeFile(join(vault, ".markd", "assets", "spoofed.png"), "not a PNG");
    await writeFile(join(vault, ".markd", "assets", "active.svg"), "<svg/>");
    await writeFile(join(scratch, "cloud-session.json"), JSON.stringify({
      accessToken: "token_123",
      expiresAt: Date.now() + 60_000,
      account: { email: "reader@example.com", plan: "cloud" },
    }));
    let networkCalls = 0;
    const fetch: typeof globalThis.fetch = async () => {
      networkCalls += 1;
      throw new Error("invalid assets must fail before publishing");
    };
    const canonicalVault = await realpath(vault);
    const engine = new CloudEngine(
      scratch,
      () => canonicalVault,
      verified,
      fetch,
    );

    for (const path of ["spoofed.png", "active.svg"]) {
      await expect(engine.publish({
        rel: "Home.md",
        title: "Home",
        content: `![asset](.markd/assets/${path})`,
        pages: [],
      })).rejects.toMatchObject({ kind: "INVALID_PUBLISH_ASSET" });
    }
    expect(networkCalls).toBe(0);
  });

  test("remote sign-out failure still removes the authoritative local session", async () => {
    const scratch = await mkdtemp(join(tmpdir(), "riffle-cloud-signout-"));
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

async function listen(
  handler: RequestListener,
): Promise<{ server: Server; origin: string }> {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return { server, origin: `http://127.0.0.1:${address.port}` };
}

function respondJson(
  response: import("node:http").ServerResponse,
  value: unknown,
  status = 200,
): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
}

async function requestBody(request: import("node:http").IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

async function closeServer(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => error ? reject(error) : resolve()),
  );
}
