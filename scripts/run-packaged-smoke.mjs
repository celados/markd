import { spawn } from "node:child_process";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { findPackagedApp } from "./verify-electron-package.mjs";

export function parsePackagedAppArgs(args) {
  const positional = args[0] === "--" ? args.slice(1) : args;
  if (positional.length > 1 || positional[0] === "--" || positional[0] === "") {
    throw new Error("Usage: run-packaged-smoke.mjs [--] [path/to/Markd.app]");
  }
  return positional[0] ?? null;
}

function runPackagedSmoke(appPath) {
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
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (
  invokedPath &&
  pathToFileURL(invokedPath).href === import.meta.url
) {
  try {
    const explicitApp = parsePackagedAppArgs(process.argv.slice(2));
    const appPath =
      explicitApp ?? findPackagedApp(join(process.cwd(), "release", "electron"));
    runPackagedSmoke(appPath);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
