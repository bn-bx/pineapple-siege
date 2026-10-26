// Type-checks src/ with the project's TypeScript settings, minus Vite's
// ambient types (which only exist when Vite is installed).
//   node scripts/offline/typecheck.mjs
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const config = JSON.parse(fs.readFileSync(path.join(repo, "tsconfig.json"), "utf8"));
const hasVite = fs.existsSync(path.join(repo, "node_modules/vite/client.d.ts"));
config.compilerOptions.types = hasVite ? config.compilerOptions.types : [];
config.include = [path.join(repo, "src")];
const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "tsc-")), "tsconfig.json");
fs.writeFileSync(file, JSON.stringify(config));
try {
  execFileSync(process.execPath, [path.join(repo, "node_modules/typescript/bin/tsc"), "-p", file, "--noEmit"], { stdio: "inherit" });
  console.log("Type check passed.");
} catch {
  process.exitCode = 1;
}
