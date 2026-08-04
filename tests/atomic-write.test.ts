import { mkdtemp, mkdir, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { writeFileAtomically } from "../electron/atomic-write";

test("failed atomic rename removes its temporary file", async () => {
  const scratch = await mkdtemp(join(tmpdir(), "riffle-atomic-write-"));
  const target = join(scratch, "cloud-session.json");
  await mkdir(target);

  await expect(writeFileAtomically(target, "secret", 0o600)).rejects.toBeDefined();
  expect(await readdir(scratch)).toEqual(["cloud-session.json"]);
});
