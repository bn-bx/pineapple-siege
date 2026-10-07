import { defineConfig } from "vite";
import { rmSync, writeFileSync, mkdirSync } from "node:fs";
import type { Connect } from "vite";
const saveBenchmark: Connect.NextHandleFunction = (request, response, next) => {
  if (
    !["/__benchmark-report", "/__benchmark-scene"].includes(
      request.url ?? "",
    ) ||
    request.method !== "POST"
  )
    return next();
  let body = "";
  const limit = request.url === "/__benchmark-scene" ? 16_000_000 : 2_000_000;
  request.on("data", (chunk) => {
    body += chunk;
    if (body.length > limit) request.destroy();
  });
  request.on("end", () => {
    try {
      const report = JSON.parse(body);
      if (request.url === "/__benchmark-scene") {
        if (
          typeof report.image !== "string" ||
          !report.image.startsWith("data:image/png;base64,")
        )
          throw Error("Invalid scene image");
        const name = "artifacts/PERFORMANCE_SCENE_" + Date.now() + ".png";
        mkdirSync("artifacts", { recursive: true });
        writeFileSync(name, Buffer.from(report.image.slice(22), "base64"));
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify({ path: name }));
        return;
      }
      if (!Array.isArray(report)) throw Error("Invalid report");
      const name = "artifacts/PERFORMANCE_NATIVE_" + Date.now() + ".json";
      mkdirSync("artifacts", { recursive: true });
      writeFileSync(name, JSON.stringify(report, null, 2));
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ path: name }));
    } catch {
      response.statusCode = 400;
      response.end("Invalid report");
    }
  });
};
export default defineConfig({
  plugins: [
    {
      name: "local-performance-report",
      configureServer(server) {
        server.middlewares.use(saveBenchmark);
      },
      configurePreviewServer(server) {
        server.middlewares.use(saveBenchmark);
      },
    },
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
  build: {
    rollupOptions: {
      input: { game: "index.html", performance: "performance.html" },
    },
    target: "es2022",
    chunkSizeWarningLimit: 1500,
  },
  server: { host: "127.0.0.1" },
});
