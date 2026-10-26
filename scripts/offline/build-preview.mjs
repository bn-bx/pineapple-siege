// Local preview build of Pineapple Siege without Vite: tsc emit + import rewrites.
// Used by run-local.command when Vite's native bundler cannot load.
// usage: node build-nb.mjs <repo> <outRoot>
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const [repo, outRoot] = process.argv.slice(2).map((p) => path.resolve(p));
fs.rmSync(outRoot, { recursive: true, force: true });
fs.mkdirSync(outRoot, { recursive: true });
const tsconfig = path.join(outRoot, "tsconfig.nb.json");
fs.writeFileSync(
  tsconfig,
  JSON.stringify({
    compilerOptions: {
      target: "ES2022",
      module: "ESNext",
      moduleResolution: "Bundler",
      allowJs: true,
      resolveJsonModule: true,
      rewriteRelativeImportExtensions: true,
      skipLibCheck: true,
      noEmitOnError: false,
      types: [],
      lib: ["ES2022", "DOM", "WebWorker"],
      rootDir: path.join(repo, "src"),
      outDir: path.join(outRoot, "src"),
      useDefineForClassFields: true,
    },
    include: [path.join(repo, "src")],
    exclude: [path.join(repo, "src/review")],
  }),
);
try {
  execFileSync(
    process.execPath,
    [path.join(repo, "node_modules/typescript/bin/tsc"), "-p", tsconfig],
    { stdio: "pipe" },
  );
} catch (e) {
  // Type errors (e.g. missing vite/client types) still emit.
  const out = String(e.stdout);
  const errors = out.split("\n").filter((l) => l.includes("error TS"));
  if (errors.some((l) => !/TS2307|TS2882|TS2339|TS7016/.test(l)))
    console.warn(errors.slice(0, 10).join("\n"));
}

const rapierPkg = JSON.parse(
  fs.readFileSync(
    path.join(repo, "node_modules/@dimforge/rapier3d-compat/package.json"),
  ),
);
const bare = (spec) => {
  if (spec === "three") return "/node_modules/three/build/three.module.js";
  if (spec.startsWith("three/addons/"))
    return "/vendor/jsm/" + spec.slice(13);
  if (spec.startsWith("three/examples/jsm/"))
    return "/vendor/jsm/" + spec.slice(19);
  if (spec === "@dimforge/rapier3d-compat")
    return (
      "/node_modules/@dimforge/rapier3d-compat/" +
      (rapierPkg.module ?? rapierPkg.main)
    );
  return null;
};

const walk = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory()
      ? walk(path.join(dir, d.name))
      : [path.join(dir, d.name)],
  );
const srcOut = path.join(outRoot, "src");
// Copy JSON and CSS the emitter may skip.
for (const file of walk(path.join(repo, "src"))) {
  if (!/\.(json|css|mjs)$/.test(file)) continue;
  const target = path.join(srcOut, path.relative(path.join(repo, "src"), file));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(file, target);
}
let cssLinks = [];
for (const file of walk(srcOut)) {
  if (!/\.(m?js)$/.test(file)) continue;
  let s = fs.readFileSync(file, "utf8");
  const fix = (spec) => {
    const b = bare(spec);
    if (b) return b;
    if (!spec.startsWith(".")) return spec;
    if (/\.(m?js|json)$/.test(spec)) return spec;
    if (spec.endsWith(".ts")) return spec.slice(0, -3) + ".js";
    const abs = path.resolve(path.dirname(file), spec);
    if (fs.existsSync(abs + ".js")) return spec + ".js";
    if (fs.existsSync(abs + ".mjs")) return spec + ".mjs";
    if (fs.existsSync(path.join(abs, "index.js"))) return spec + "/index.js";
    return spec;
  };
  // CSS side-effect imports become <link> tags.
  s = s.replace(/^import\s+["']([^"']+\.css)["'];?\s*$/gm, (_m, spec) => {
    cssLinks.push(
      "/" + path.relative(outRoot, path.resolve(path.dirname(file), spec)),
    );
    return "";
  });
  s = s.replace(
    /((?:import|export)\s[^'"]*?from\s*|import\s*\(\s*|import\s+)(["'])([^"']+)\2(\s*with\s*\{[^}]*\})?/g,
    (_m, head, q, spec, attr) => {
      const fixed = fix(spec);
      const json = fixed.endsWith(".json");
      return `${head}${q}${fixed}${q}${json ? attr ?? ' with { type: "json" }' : attr ?? ""}`;
    },
  );
  s = s.replace(
    /new URL\((["'])([^"']+)\.ts\1,\s*import\.meta\.url\)/g,
    (_m, q, p) => `new URL(${q}${p}.js${q}, import.meta.url)`,
  );
  fs.writeFileSync(file, s);
}
// Three's addons import bare "three"; module workers have no import maps.
const jsm = path.join(repo, "node_modules/three/examples/jsm");
for (const file of walk(jsm)) {
  if (!file.endsWith(".js")) continue;
  const target = path.join(outRoot, "vendor/jsm", path.relative(jsm, file));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(
    target,
    fs
      .readFileSync(file, "utf8")
      .replace(/(["'])three\1/g, '"/node_modules/three/build/three.module.js"'),
  );
}
let html = fs.readFileSync(path.join(repo, "index.html"), "utf8");
html = html
  .replaceAll("__BUILD_VERSION__", "local")
  .replace('src="/src/main.ts"', 'src="/src/main.js"')
  .replace(
    "</head>",
    [...new Set(cssLinks)].map((h) => `<link rel="stylesheet" href="${h}">`).join("\n") +
      "\n</head>",
  );
fs.writeFileSync(path.join(outRoot, "index.html"), html);
// Relative links keep a preview usable when the folder is opened on another
// machine or through a different mount path.
const link = (target, at) => fs.symlinkSync(path.relative(path.dirname(at), target), at);
link(path.join(repo, "node_modules"), path.join(outRoot, "node_modules"));
for (const name of fs.readdirSync(path.join(repo, "public")))
  if (!fs.existsSync(path.join(outRoot, name)))
    link(path.join(repo, "public", name), path.join(outRoot, name));
console.log("built", outRoot, "css:", cssLinks);
