import { _electron as electron, expect, test } from "@playwright/test";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runSecureContentJourney } from "../shared/secure-content-journey";

test("packaged utility queries the configured Vault", async () => {
  const executablePath = process.env.MARKD_PACKAGED_EXECUTABLE;
  if (!executablePath) throw new Error("MARKD_PACKAGED_EXECUTABLE is required.");
  const scratch = await mkdtemp(join(tmpdir(), "markd-packaged-smoke-"));
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
      MARKD_E2E_BACKGROUND: "1",
      MARKD_TEST_CONFIG_DIR: configDir,
      MARKD_TEST_QUICK_CAPTURE_ACCELERATOR: "F24",
    },
  });
  try {
    const page = await application.firstWindow();
    await expect.poll(() => page.evaluate(() => window.markd?.vault.startup())).toEqual({
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
  const executablePath = process.env.MARKD_PACKAGED_EXECUTABLE;
  if (!executablePath) throw new Error("MARKD_PACKAGED_EXECUTABLE is required.");

  await runSecureContentJourney((configDir) => electron.launch({
    executablePath,
    env: {
      ...process.env,
      MARKD_E2E_BACKGROUND: "1",
      MARKD_TEST_CONFIG_DIR: configDir,
      MARKD_TEST_QUICK_CAPTURE_ACCELERATOR: "F24",
    },
  }));
});
