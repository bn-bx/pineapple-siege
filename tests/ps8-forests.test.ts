import { expect, it } from "vitest";
import { generateIsland, sampleHeight } from "../src/world/generator.mjs";
import { onMainland } from "../src/world/landscape.mjs";

it("PS8 grows coastal palms, denser woods and uninhabited offshore islands", () => {
  const ps7 = generateIsland({ seed: 41729, generatorVersion: 7 }),
    ps8 = generateIsland({ seed: 41729, generatorVersion: 8 }),
    again = generateIsland({ seed: 41729, generatorVersion: 8 });
  expect(ps8.world.generatorVersion).toBe(8);
  expect(ps8.world.version).toBe(14);
  expect(Buffer.from(again.heights.buffer).equals(Buffer.from(ps8.heights.buffer))).toBe(true);

  const trees = (w: typeof ps8.world) => w.entities.filter((e) => e.kind === "tree");
  const old = trees(ps7.world),
    current = trees(ps8.world);
  expect(old.some((e) => e.treeSpecies === "palm")).toBe(false);
  // Woods are denser than PS7's, before counting palms.
  expect(current.filter((e) => e.treeSpecies !== "palm").length).toBeGreaterThan(old.length);
  expect(current.length).toBeLessThanOrEqual(30000);
  expect(trees(again.world)).toEqual(current);

  const palms = current.filter((e) => e.treeSpecies === "palm");
  expect(palms.length).toBeGreaterThan(200);
  for (const palm of palms) {
    const ground = palm.p[1] - palm.s[1];
    expect(ground).toBeLessThan(26.5);
    expect(ground).toBeGreaterThanOrEqual(2.4);
    let seaward = false;
    for (let k = 0; k < 8 && !seaward; k++)
      for (const r of [45, 110]) {
        const a = (k * Math.PI) / 4;
        if (sampleHeight(ps8.heights, palm.p[0] + Math.cos(a) * r, palm.p[2] + Math.sin(a) * r) < -1)
          seaward = true;
      }
    expect(seaward).toBe(true);
  }
  // Offshore islands carry their own woods as well as palms.
  const offshoreTrees = current.filter(
    (e) => !onMainland(ps8.world.mainland, e.p[0], e.p[2]),
  );
  expect(offshoreTrees.some((e) => e.treeSpecies !== "palm")).toBe(true);

  // Offshore islands are real land, separate from the mainland, with no settlements.
  const offshore = ps8.world.offshoreIslands!;
  expect(offshore.length).toBeGreaterThanOrEqual(3);
  for (const island of offshore) {
    const [x, z] = island.p;
    if (island.kind !== "atoll") {
      expect(sampleHeight(ps8.heights, x, z)).toBeGreaterThan(0);
      expect(onMainland(ps8.world.mainland, x, z)).toBe(false);
    }
    for (const site of ps8.world.sites)
      expect(Math.hypot(site.p[0] - x, site.p[2] - z)).toBeGreaterThan(island.extent);
  }
}, 180_000);
