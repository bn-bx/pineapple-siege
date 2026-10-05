import { mkdirSync, writeFileSync } from "node:fs";
import { generateIsland, seedCode } from "../src/world/generator.mjs";
const seed = Number(process.env.ISLAND_SEED ?? 41729);
const { world, heights } = generateIsland(seed);
mkdirSync("public", { recursive: true });
const bytes = new Uint8Array(heights.buffer);
writeFileSync("public/world.bin", bytes);
world.heightFiles = [];
for (let offset = 0; offset < bytes.length; offset += 20 * 1024 * 1024) {
  const name = `world-${world.heightFiles.length}.bin`;
  world.heightFiles.push(name);
  writeFileSync(
    `public/${name}`,
    bytes.subarray(offset, offset + 20 * 1024 * 1024),
  );
}
writeFileSync("public/world.json", JSON.stringify(world));
console.log(
  `Island ${seedCode(seed)}: ${world.grid}² samples, ${world.structureCount} structural parts, ${world.entities.length} entities, ${world.civilians.length} residents`,
);
