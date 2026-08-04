import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { writeFileAtomically } from "./atomic-write";

export async function importLegacyConfig(
  currentConfigDir: string,
  legacyConfigDir: string,
): Promise<boolean> {
  if (currentConfigDir === legacyConfigDir) return false;
  const current = join(currentConfigDir, "config.json");
  if (await exists(current)) return false;
  const legacy = join(legacyConfigDir, "config.json");
  let content: string;
  try {
    content = await readFile(legacy, "utf8");
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
  // Installed clients already own this Vault selection. Importing only the
  // durable config avoids carrying Chromium caches across the product rename.
  await writeFileAtomically(current, content, 0o600);
  return true;
}

async function exists(path: string): Promise<boolean> {
  try {
    await readFile(path);
    return true;
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
