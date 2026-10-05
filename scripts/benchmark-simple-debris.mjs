import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
const dir = await mkdtemp(join(tmpdir(), "siege-physics-"));
try {
  const outfile = join(dir, "run.mjs");
  await build({
    entryPoints: ["scripts/benchmark-simple-debris.ts"],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    banner: {
      js: 'import{createRequire}from"node:module";const require=createRequire(import.meta.url);',
    },
  });
  await import(pathToFileURL(outfile).href);
} finally {
  await rm(dir, { recursive: true, force: true });
}
