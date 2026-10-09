import { mkdirSync, writeFileSync } from "node:fs";
import { expect, it } from "vitest";
import {
  NuclearFire,
  FIRE_LIMIT,
  type FireHost,
} from "../src/sim/nuclear-fire";
import { NuclearFireView } from "../src/render/nuclear-fire";
import { ResourceDisposal } from "../src/render/resource-disposal";
import { NUKE_PROFILES } from "../src/config";
it("bounds rapid-strike simulation and rendering work without growing sprite buffers", () => {
  const fire = new NuclearFire(),
    view = new NuclearFireView(),
    resources = new ResourceDisposal();
  const host: FireHost = {
    ground: () => 30,
    water: () => false,
    ids: () => [],
    entity: () => undefined,
    removed: () => false,
    burn: () => {},
    actors: () => {},
  };
  const flames = view.flames.instanceMatrix.array,
    smoke = view.smoke.instanceMatrix.array;
  const samples: number[] = [];
  try {
    for (let tick = 0; tick < 1800; tick++) {
      if (tick % 6 === 0) {
        const n = tick / 6;
        fire.ignite(
          [600 + ((n * 337) % 4900), 30, 600 + ((n * 919) % 4900)],
          NUKE_PROFILES.valley,
          n,
          1,
          host,
        );
      }
      const start = performance.now();
      fire.step(1 / 60, host);
      view.update(fire.patches, 1 / 60, false, tick / 60);
      samples.push(performance.now() - start);
      expect(fire.patches.length).toBeLessThanOrEqual(FIRE_LIMIT);
      expect(view.flames.count).toBeLessThanOrEqual(FIRE_LIMIT * 8);
    }
    samples.sort((a, b) => a - b);
    console.info(
      JSON.stringify({
        nuclearFireBenchmark: {
          strikes: 300,
          simulatedSeconds: 30,
          activePatches: fire.patches.length,
          fullSprites: view.flames.count + view.smoke.count,
          medianMS: Number(samples[900].toFixed(3)),
          p95MS: Number(samples[1710].toFixed(3)),
        },
      }),
    );
    mkdirSync("artifacts", { recursive: true });
    writeFileSync("artifacts/nuclear-fire-benchmark.json", JSON.stringify({
      strikes: 300, simulatedSeconds: 30, activePatches: fire.patches.length,
      fullSprites: view.flames.count + view.smoke.count,
      medianMS: samples[900], p95MS: samples[1710],
      measurement: "CPU fire simulation and instance preparation; excludes GPU draw time and structural targets",
    }, null, 2) + "\n");
    expect(view.flames.instanceMatrix.array).toBe(flames);
    expect(view.smoke.instanceMatrix.array).toBe(smoke);
  } finally {
    view.collectResources(resources);
    resources.dispose();
  }
});
