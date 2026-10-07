import { readFile, readdir, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

const manifest = JSON.parse(await readFile("src/runtime-assets.json", "utf8"));
const runtimeFiles = [
  manifest.modelLibrary,
  manifest.fruitSkin,
  manifest.puffAtlas,
  ...Object.values(manifest.surfaces).flatMap((channels) => Object.values(channels)),
  ...Object.values(manifest.foliage),
  ...Object.values(manifest.audio),
];
const bundledPaths = [];
for (const asset of runtimeFiles) {
  const bytes = await readFile(path.join("dist", asset.path.slice(1)));
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (sha256 !== asset.sha256) throw Error(`Production asset differs from its manifest: ${asset.path}`);
  await stat(path.join("dist", asset.source.slice(1)));
  bundledPaths.push(asset.path);
}
for (const [name, record] of Object.entries(manifest.decoders.files)) {
  await stat(path.join("dist", manifest.decoders.path.slice(1), name));
  await stat(path.join("dist", record.source.slice(1)));
}
bundledPaths.push(manifest.decoders.path);
const bundleNames = (await readdir("dist/assets")).filter((name) => name.endsWith(".js"));
const bundles = await Promise.all(
  bundleNames.map((name) => readFile(path.join("dist/assets", name), "utf8")),
);
const bundleText = bundles.join("\n");
for (const url of bundledPaths) {
  if (!bundleText.includes(url)) throw Error(`Production bundle does not reference hashed asset URL: ${url}`);
}
console.log(`Verified ${runtimeFiles.length + Object.keys(manifest.decoders.files).length} hashed runtime assets and their legacy URL compatibility copies in dist.`);
