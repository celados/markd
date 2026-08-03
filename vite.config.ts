import { defineConfig } from "vite";
import { octane } from "octane/compiler/vite";
import tailwindcss from "@tailwindcss/vite";
import electron from "vite-plugin-electron/simple";
import path from "path";

export default defineConfig(async ({ mode }) => ({
  plugins: [
    octane(),
    tailwindcss(),
    ...(mode === "web"
      ? []
      : [
          electron({
            main: {
              entry: {
                main: "electron/main.ts",
                engine: "electron/engine.ts",
              },
              vite: {
                build: {
                  rolldownOptions: {
                    // ffi-rs loads platform binaries at runtime; bundling its
                    // native package would turn the binary into invalid JS.
                    external: ["@ff-labs/fff-node"],
                  },
                },
              },
            },
            preload: {
              input: "electron/preload.ts",
            },
          }),
        ]),
  ],

  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src/"),
      "@/components": path.resolve(__dirname, "./src/components/"),
      "@/context": path.resolve(__dirname, "./src/context/"),
      "@/hooks": path.resolve(__dirname, "./src/hooks/"),
      "@/lib": path.resolve(__dirname, "./src/lib/"),
      "@/stores": path.resolve(__dirname, "./src/stores/"),
      "@/features": path.resolve(__dirname, "./src/features/"),
    },
  },
  base: "./",
}));
