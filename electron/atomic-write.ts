import { randomUUID } from "node:crypto";
import { chmod, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export async function writeFileAtomically(
  target: string,
  content: string,
  mode?: number,
): Promise<void> {
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.tmp-${randomUUID()}`;
  try {
    await writeFile(temporary, content, mode === undefined ? undefined : { mode });
    if (mode !== undefined) await chmod(temporary, mode);
    await rename(temporary, target);
  } catch (error) {
    // Failed atomic writes must not leave credential or Vault metadata fragments
    // for later scans, backups, or manual recovery to mistake for live state.
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}
