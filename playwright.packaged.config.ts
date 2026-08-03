import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/packaged",
  outputDir: "./test-results/packaged",
  reporter: "list",
  workers: 1,
});
