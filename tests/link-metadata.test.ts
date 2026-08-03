import { describe, expect, test, vi } from "vitest";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import {
  fetchLinkMetadata,
  parseLinkMetadata,
  PinnedMetadataTransport,
} from "../electron/link-metadata";

const publicResolver = async () => ["93.184.216.34"];

describe("bookmark link metadata", () => {
  test("uses a mature HTML parser and resolves relative metadata URLs", () => {
    expect(parseLinkMetadata([
      "<html><head>",
      '<title>Fallback &amp; title</title>',
      '<meta property="og:title" content="OG &amp; title">',
      '<meta property="og:image" content="/preview.png">',
      '<link rel="icon" href="assets/favicon.svg">',
      "</head></html>",
    ].join(""), new URL("https://example.com/posts/one"))).toEqual({
      title: "OG & title",
      image: "https://example.com/preview.png",
      favicon: "https://example.com/posts/assets/favicon.svg",
    });
  });

  test("rejects active and non-HTTP metadata asset URLs", () => {
    expect(parseLinkMetadata([
      '<meta property="og:image" content="javascript:alert(1)">',
      '<link rel="icon" href="data:image/svg+xml,nope">',
    ].join(""), new URL("https://example.com/page"))).toEqual({
      title: undefined,
      image: undefined,
      favicon: undefined,
    });
  });

  test("production transport connects through the approved address instead of system DNS", async () => {
    const server = createServer((_request, response) => response.end("ok"));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    const transport = new PinnedMetadataTransport();
    transport.bindApprovedDestination("metadata.test", [{ address: "127.0.0.1", family: 4 }]);
    try {
      const response = await transport.fetch(new URL(`http://metadata.test:${port}/`), {});
      await expect(response.text()).resolves.toBe("ok");
    } finally {
      await transport.close();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => error ? reject(error) : resolve()));
    }
  });

  test.each([
    "not a URL",
    "file:///etc/passwd",
    "ftp://example.com/file",
    "https://user:password@example.com",
  ])("rejects invalid or non-HTTP URL %s", async (url) => {
    const fetchImplementation = vi.fn<typeof fetch>();
    await expect(fetchLinkMetadata(url, {
      fetch: fetchImplementation,
      resolve: publicResolver,
    })).rejects.toThrow(/invalid|public HTTP\(S\)/u);
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  test.each([
    "http://127.0.0.1",
    "http://10.0.0.1",
    "http://169.254.169.254/latest/meta-data",
    "http://[::1]",
    "http://[fc00::1]",
    "http://[::ffff:127.0.0.1]",
  ])("rejects non-public literal destination %s", async (url) => {
    const fetchImplementation = vi.fn<typeof fetch>();
    await expect(fetchLinkMetadata(url, { fetch: fetchImplementation }))
      .rejects.toThrow(/non-public/u);
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  test("rejects a hostname when any DNS answer is non-public", async () => {
    const fetchImplementation = vi.fn<typeof fetch>();
    await expect(fetchLinkMetadata("https://mixed.example", {
      fetch: fetchImplementation,
      resolve: async () => ["93.184.216.34", "192.168.1.2"],
    })).rejects.toThrow(/non-public/u);
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  test("validates every manual redirect before issuing the next request", async () => {
    const requests: string[] = [];
    const fetchImplementation: typeof fetch = async (input) => {
      requests.push(String(input));
      return new Response(null, {
        status: 302,
        headers: { location: "http://169.254.169.254/latest/meta-data" },
      });
    };
    await expect(fetchLinkMetadata("https://example.com/start", {
      fetch: fetchImplementation,
      resolve: publicResolver,
    })).rejects.toThrow(/non-public/u);
    expect(requests).toEqual(["https://example.com/start"]);
  });

  test("follows a bounded public redirect and uses the final URL as metadata base", async () => {
    const fetchImplementation: typeof fetch = async (input) =>
      String(input).endsWith("/start")
        ? new Response(null, { status: 302, headers: { location: "/final/page" } })
        : new Response('<title>Final</title><link rel="icon" href="icon.svg">');
    await expect(fetchLinkMetadata("https://example.com/start", {
      fetch: fetchImplementation,
      resolve: publicResolver,
    })).resolves.toEqual({
      title: "Final",
      image: undefined,
      favicon: "https://example.com/final/icon.svg",
    });
  });

  test("stops a public redirect loop at the configured bound", async () => {
    const cancelled = vi.fn();
    const fetchImplementation = vi.fn<typeof fetch>(async () => new Response(
      new ReadableStream({ cancel: cancelled }),
      { status: 302, headers: { location: "/again" } },
    ));
    await expect(fetchLinkMetadata("https://example.com/start", {
      fetch: fetchImplementation,
      resolve: publicResolver,
      maximumRedirects: 2,
    })).rejects.toThrow(/redirect limit/u);
    expect(fetchImplementation).toHaveBeenCalledTimes(3);
    expect(cancelled).toHaveBeenCalledTimes(3);
  });

  test("cancels redirect and HTTP error bodies before rejecting", async () => {
    const missingLocationCancelled = vi.fn();
    await expect(fetchLinkMetadata("https://example.com/start", {
      fetch: async () => new Response(
        new ReadableStream({ cancel: missingLocationCancelled }),
        { status: 302 },
      ),
      resolve: publicResolver,
    })).rejects.toThrow(/no location/u);
    expect(missingLocationCancelled).toHaveBeenCalledOnce();

    const httpErrorCancelled = vi.fn();
    await expect(fetchLinkMetadata("https://example.com/start", {
      fetch: async () => new Response(
        new ReadableStream({ cancel: httpErrorCancelled }),
        { status: 503 },
      ),
      resolve: publicResolver,
    })).rejects.toThrow(/503/u);
    expect(httpErrorCancelled).toHaveBeenCalledOnce();
  });

  test("rejects oversized documents declared by content length", async () => {
    const cancelled = vi.fn();
    const fetchImplementation: typeof fetch = async () => new Response(
      new ReadableStream({ cancel: cancelled }),
      { headers: { "content-length": String(3 * 1024 * 1024) } },
    );
    await expect(fetchLinkMetadata("https://example.com", {
      fetch: fetchImplementation,
      resolve: publicResolver,
    })).rejects.toThrow(/too large/u);
    expect(cancelled).toHaveBeenCalledOnce();
  });

  test("rejects oversized streaming documents without content length", async () => {
    const chunk = new Uint8Array(1024 * 1024 + 1);
    const cancelled = vi.fn();
    const fetchImplementation: typeof fetch = async () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(chunk);
        controller.enqueue(chunk);
      },
      cancel: cancelled,
    }));
    await expect(fetchLinkMetadata("https://example.com", {
      fetch: fetchImplementation,
      resolve: publicResolver,
    })).rejects.toThrow(/too large/u);
    expect(cancelled).toHaveBeenCalledOnce();
  });

  test("aborts a metadata request at the configured timeout", async () => {
    const fetchImplementation: typeof fetch = async (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      });
    await expect(fetchLinkMetadata("https://example.com", {
      fetch: fetchImplementation,
      resolve: publicResolver,
      timeoutMs: 5,
    })).rejects.toThrow(/timeout|aborted/iu);
  });

  test("the same deadline also bounds DNS resolution", async () => {
    const fetchImplementation = vi.fn<typeof fetch>();
    await expect(fetchLinkMetadata("https://example.com", {
      fetch: fetchImplementation,
      resolve: async () => new Promise<string[]>(() => {}),
      timeoutMs: 5,
    })).rejects.toThrow(/timeout|aborted/iu);
    expect(fetchImplementation).not.toHaveBeenCalled();
  });
});
