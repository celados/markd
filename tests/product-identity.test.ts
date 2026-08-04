import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { importLegacyConfig } from "../electron/product-identity";

test("imports the legacy Vault selection once without overwriting Riffle state", async () => {
  const scratch = await mkdtemp(join(tmpdir(), "riffle-product-identity-"));
  const legacy = join(scratch, "Markd");
  const current = join(scratch, "Riffle");
  await mkdir(legacy);
  await writeFile(join(legacy, "config.json"), '{"vaultPath":"/legacy"}\n');

  await expect(importLegacyConfig(current, legacy)).resolves.toBe(true);
  expect(await readFile(join(current, "config.json"), "utf8"))
    .toBe('{"vaultPath":"/legacy"}\n');

  await writeFile(join(current, "config.json"), '{"vaultPath":"/current"}\n');
  await expect(importLegacyConfig(current, legacy)).resolves.toBe(false);
  expect(await readFile(join(current, "config.json"), "utf8"))
    .toBe('{"vaultPath":"/current"}\n');
});

test("does nothing when no legacy config exists", async () => {
  const scratch = await mkdtemp(join(tmpdir(), "riffle-product-identity-missing-"));
  await expect(importLegacyConfig(join(scratch, "Riffle"), join(scratch, "Markd")))
    .resolves.toBe(false);
});
