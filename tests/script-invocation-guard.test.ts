import { afterEach, describe, expect, test } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";

const originalArgv = [...process.argv];

afterEach(() => {
  process.argv.splice(0, process.argv.length, ...originalArgv);
});

describe("script direct-invocation guards", () => {
  test.each([
    ["missing", null],
    ["nonexistent", join(tmpdir(), "markd-nonexistent-script-entry")],
    ["non-file", process.cwd()],
  ])("imports the package script graph when argv[1] is %s", async (name, argv1) => {
    process.argv.splice(0, process.argv.length, originalArgv[0]);
    if (argv1) process.argv.push(argv1);

    const nonce = `${name}-${Date.now()}-${Math.random()}`;
    const smokeUrl = new URL(`../scripts/run-packaged-smoke.mjs?guard=${nonce}`, import.meta.url);
    const verifyUrl = new URL(`../scripts/verify-electron-package.mjs?guard=${nonce}`, import.meta.url);
    await expect(import(smokeUrl.href)).resolves.toBeDefined();
    await expect(import(verifyUrl.href)).resolves.toBeDefined();
  });
});
