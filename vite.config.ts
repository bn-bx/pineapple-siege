import { defineConfig } from "vite";
import { rmSync } from "node:fs";
export default defineConfig({
  plugins: [
    {
      name: "omit-unsplit-terrain",
      apply: "build",
      closeBundle() {
        rmSync("dist/world.bin", { force: true });
      },
    },
  ],
  base: "./",
  worker: { format: "es" },
  build: { target: "es2022", chunkSizeWarningLimit: 1500 },
  server: { host: "127.0.0.1" },
});
