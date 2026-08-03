import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/electron",
  outputDir: "./test-results/electron",
  reporter: "list",
  workers: 1,
});
