import { readFile } from "node:fs/promises";
// Node module hooks for the offline test runner: route "vitest" to the shim and
// resolve extensionless relative imports the way Vite does.
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
const shim = new URL("./vitest-shim.mjs", import.meta.url).href;
export async function resolve(spec, ctx, next) {
  if (spec === "vitest") return { url: shim, shortCircuit: true };
  if ((spec.startsWith(".") || spec.startsWith("/")) && ctx.parentURL?.startsWith("file:")) {
    const base = new URL(spec, ctx.parentURL);
    const p = fileURLToPath(base);
    if (!/\.[cm]?[jt]s$|\.json$/.test(p)) {
      for (const ext of [".ts", ".mjs", ".js"])
        if (existsSync(p + ext)) return { url: base.href + ext, shortCircuit: true };
      for (const ext of ["/index.ts", "/index.js"])
        if (existsSync(p + ext)) return { url: pathToFileURL(p + ext).href, shortCircuit: true };
    }
  }
  return next(spec, ctx);
}

// Vite lets source import JSON without `with { type: "json" }`; serve JSON as
// an ES module so both forms load.
export async function load(url, ctx, next) {
  if (url.startsWith("file:") && url.endsWith(".json")) {
    const text = await readFile(new URL(url), "utf8");
    return { format: "module", source: `export default ${text};`, shortCircuit: true };
  }
  return next(url, ctx);
}
