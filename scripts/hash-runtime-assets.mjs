import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const runtimeRoot = "public/assets/runtime";
const manifestPath = "src/runtime-assets.json";
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function addAsset(source) {
  const bytes = await readFile(source);
  const sha256 = digest(bytes);
  const relative = path.relative("public/assets", source);
  const extension = path.extname(relative);
  const stem = path.basename(relative, extension);
  const folder = path.dirname(relative);
  const filename = `${stem}.${sha256}${extension}`;
  const target = path.join(runtimeRoot, folder, filename);
  await mkdir(path.dirname(target), { recursive: true });
  await copyFile(source, target);
  return {
    path: `/assets/runtime/${path.posix.join(folder.split(path.sep).join("/"), filename)}`,
    sha256,
    source: `/assets/${relative.split(path.sep).join("/")}`,
  };
}

const families = ["stone", "wood", "grass", "rock", "soil", "sand", "roof", "bark", "cloth"];
const foliageFamilies = [
  "pine",
  "broadleaf",
  "grass",
  "pine-impostor",
  "broadleaf-impostor",
  "riverside-impostor",
];
const recordingNames = ["turbine", "wind", "forest", "river", "explosion", "wood", "stone", "cheer"];

await rm(runtimeRoot, { recursive: true, force: true });
await mkdir(runtimeRoot, { recursive: true });

const manifest = {
  version: 1,
  cachePolicy: "sha256-filename",
  modelLibrary: await addAsset("public/assets/models/siege-library.glb"),
  fruitSkin: await addAsset("public/assets/materials/pineapple-skin-v1.ktx2"),
  surfaces: {},
  foliage: {},
  puffAtlas: await addAsset("public/assets/particles/puff-atlas.ktx2"),
  decoders: {},
  audio: {},
};

for (const family of families) {
  manifest.surfaces[family] = {};
  for (const channel of ["color", "normal", "orm"]) {
    manifest.surfaces[family][channel] = await addAsset(
      `public/assets/materials/${family}-${channel}.ktx2`,
    );
  }
}
for (const family of foliageFamilies) {
  manifest.foliage[family] = await addAsset(`public/assets/foliage/${family}.ktx2`);
}
for (const name of recordingNames) {
  const extension = name === "wood" || name === "stone" || name === "cheer" ? "ogg" : "wav";
  manifest.audio[name] = await addAsset(`public/assets/audio/${name}.${extension}`);
}

const decoderNames = ["basis_transcoder.js", "basis_transcoder.wasm"];
const decoderBytes = await Promise.all(
  decoderNames.map(async (name) => [name, await readFile(`public/assets/decoders/${name}`)]),
);
const decoderHashes = Object.fromEntries(
  decoderBytes.map(([name, bytes]) => [name, digest(bytes)]),
);
const decoderSetHash = digest(
  decoderNames.map((name) => `${name}:${decoderHashes[name]}`).join("\n"),
);
const decoderDirectory = path.join(runtimeRoot, "decoders", decoderSetHash);
await mkdir(decoderDirectory, { recursive: true });
for (const [name, bytes] of decoderBytes) {
  await copyFile(`public/assets/decoders/${name}`, path.join(decoderDirectory, name));
}
manifest.decoders = {
  path: `/assets/runtime/decoders/${decoderSetHash}/`,
  sha256: decoderSetHash,
  files: Object.fromEntries(
    decoderNames.map((name) => [name, { sha256: decoderHashes[name], source: `/assets/decoders/${name}` }]),
  ),
};

await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Hashed ${Object.keys(manifest.audio).length + Object.keys(manifest.foliage).length + families.length * 3 + decoderNames.length + 3} runtime assets.`);
