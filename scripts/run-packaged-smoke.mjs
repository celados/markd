import { spawn } from "node:child_process";
import { join } from "node:path";
import { findPackagedApp } from "./verify-electron-package.mjs";

const appPath =
  process.argv[2] ?? findPackagedApp(join(process.cwd(), "release", "electron"));
const executablePath =
  process.platform === "darwin"
    ? join(appPath, "Contents", "MacOS", "Markd")
    : join(appPath, "Markd");
const playwrightPath = join(
  process.cwd(),
  "node_modules",
  ".bin",
  process.platform === "win32" ? "playwright.cmd" : "playwright",
);

const child = spawn(
  playwrightPath,
  ["test", "--config", "playwright.packaged.config.ts"],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      MARKD_E2E_BACKGROUND: "1",
      MARKD_PACKAGED_EXECUTABLE: executablePath,
    },
  },
);
child.once("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.once("exit", (code, signal) => {
  if (signal) {
    console.error(`Packaged smoke terminated by ${signal}.`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = code ?? 1;
});
