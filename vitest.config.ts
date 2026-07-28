import { defineConfig } from "vitest/config";
import { octane } from "octane/compiler/vite";

export default defineConfig({
  plugins: [octane()],
  resolve: {
    alias: {
      "@": new URL("./src", import.meta.url).pathname,
    },
  },
  test: {
    include: ["test/**/*.test.ts", "tests/**/*.test.ts"],
  },
});
