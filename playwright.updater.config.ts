import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/updater",
  outputDir: "./test-results/updater",
  reporter: "list",
  workers: 1,
  timeout: 10 * 60_000,
});
