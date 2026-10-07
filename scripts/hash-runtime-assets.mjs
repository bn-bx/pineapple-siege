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

const recordingNames = ["wind", "explosion", "cheer"];

await rm(runtimeRoot, { recursive: true, force: true });
await mkdir(runtimeRoot, { recursive: true });

const manifest = {
  version: 1,
  cachePolicy: "sha256-filename",
  audio: {},
};

for (const name of recordingNames) {
  const extension = name === "cheer" ? "ogg" : "wav";
  manifest.audio[name] = await addAsset(
    `public/assets/audio/${name}.${extension}`,
  );
}

await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Hashed ${recordingNames.length} runtime audio assets.`);
