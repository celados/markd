import { spawn } from "node:child_process";
import { join } from "node:path";

const playwrightPath = join(
  process.cwd(),
  "node_modules",
  ".bin",
  process.platform === "win32" ? "playwright.cmd" : "playwright",
);
const child = spawn(
  playwrightPath,
  ["test", "--config", "playwright.updater.config.ts"],
  {
    stdio: "inherit",
    env: { ...process.env, RIFFLE_E2E_BACKGROUND: "1" },
  },
);
child.once("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.once("exit", (code, signal) => {
  if (signal) {
    console.error(`Updater smoke terminated by ${signal}.`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = code ?? 1;
});
