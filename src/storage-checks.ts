import { SaveStore, compatible } from "./storage";
import { SaveWriter } from "./save-writer";
import { packBodies } from "./sim/body-buffer";
import { CONFIG, CHUNKS } from "./config";
import type { IslandBaseline } from "./world/generator.mjs";
import type { SaveSnapshot } from "./types";
/** Native IndexedDB checks, restricted to a disposable benchmark database. */
export async function checkStorage(baseline: IslandBaseline) {
  const writer = new SaveWriter("siege-storage-checks");
  const store = new SaveStore("siege-storage-checks", writer);
  await store.open();
  const checks: string[] = [];
  const assert = (condition: unknown, label: string) => {
    if (!condition) throw Error(label);
    checks.push(label);
  };
  const save: SaveSnapshot = {
    version: 8,
    worldVersion: baseline.world.version,
    generatorVersion: 1,
    seed: baseline.world.seed,
    revision: 1,
    hour: 15,
    terrain: new Float32Array([100, 22]),
    removed: [],
    ruins: [],
    pendingJobs: [],
    lasers: [],
    laserWork: [],
    laserSupport: [],
    laserCooldown: 0,
    laserDry: new Uint32Array([100]),
    vaporized: [],
  };
  const db = (store as unknown as { db: IDBDatabase }).db;
  const seedLegacy = () =>
    new Promise<void>((resolve, reject) => {
      const tx = db.transaction("worlds", "readwrite");
      tx.objectStore("worlds").put(save, "current");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  try {
    await store.replaceBaseline(baseline);
    await seedLegacy();
    const originalWrite = store.write.bind(store);
    store.write = async () => {
      throw Error("Injected migration failure");
    };
    const protectedSave = await store.load();
    assert(
      protectedSave?.version === 8,
      "Migration failure preserves version 8",
    );
    store.write = originalWrite;
    const migrated = await store.load();
    assert(
      migrated?.version === CONFIG.version &&
        compatible(migrated, baseline.world.version, baseline.world.seed),
      "Version 8 migrates atomically to version 9",
    );
    assert(
      migrated?.terrain instanceof Float32Array &&
        migrated.terrain[1] === 22 &&
        migrated.laserDry[0] === 100,
      "Migration preserves terrain and dry cells",
    );
    const moving = packBodies(
      [
        {
          id: 999999,
          source: 0,
          kind: "chunk",
          material: "stone",
          p: [200, 500, 200],
          s: [2, 3, 4],
          q: [0, 0, 0, 1],
        },
      ],
      1,
    );
    await store.write({
      ...migrated!,
      revision: 2,
      incremental: true,
      moving,
      sections: [
        {
          id: 3,
          terrain: new Float32Array([100, 20, 101, 21]),
          dry: new Uint32Array([101]),
          ruins: [],
          removedRuins: [],
        },
      ],
    });
    const restored = await store.load();
    assert(
      restored?.revision === 2 &&
        restored.ruins.some((r) => r.id === 999999 && r.p[1] < 500),
      "Packed moving debris restores as permanent grounded rubble",
    );
    assert(
      restored?.laserDry.length === 2 &&
        restored.terrain instanceof Float32Array &&
        restored.terrain.length === 4,
      "Incremental commits merge section records",
    );
    // A synchronous clone failure after section writes must abort the transaction.
    let rejected = false;
    try {
      await store.write({
        ...restored!,
        revision: 3,
        incremental: true,
        sections: [
          {
            id: 3,
            terrain: new Float32Array([100, -100]),
            dry: new Uint32Array(),
            ruins: [],
            removedRuins: [],
          },
        ],
        invalidClone: () => {},
      } as SaveSnapshot);
    } catch {
      rejected = true;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
    const retained = await store.load();
    assert(
      rejected &&
        retained?.revision === 2 &&
        retained.terrain instanceof Float32Array &&
        retained.terrain[1] === 20,
      "Failed commit preserves metadata and section records together",
    );
    const committed = await writer.capture((port) => {
      port.postMessage({
        type: "saved",
        save: {
          ...retained!,
          revision: 5,
          capture: 35,
          incremental: true,
          sections: [],
        },
        slices: [0.2, 1.1],
      });
      port.postMessage({ type: "saveDispatch", ms: 0.1 });
      port.close();
    });
    assert(
      committed.capture === 35 &&
        committed.revision === 5 &&
        (await store.load())?.revision === 5,
      "Direct worker capture acknowledges only committed metadata and damage",
    );
    let captured!: () => void;
    const started = new Promise<void>((resolve) => {
      captured = resolve;
    });
    const waiting = writer
      .capture(() => {
        captured();
      })
      .then(
        () => false,
        () => true,
      );
    await started;
    await writer.retire();
    assert(
      (await waiting) && (await store.load())?.revision === 5,
      "Retirement rejects a waiting direct capture and preserves the previous commit",
    );
    const delayed = store
      .write({
        ...retained!,
        revision: 4,
        incremental: true,
        sections: Array.from({ length: CHUNKS * CHUNKS }, (_, id) => ({
          id,
          terrain: new Float32Array([
            Math.floor(id / CHUNKS) * 32 * CONFIG.grid + (id % CHUNKS) * 32,
            0,
          ]),
          dry: new Uint32Array(),
          ruins: [],
          removedRuins: [],
        })),
      })
      .then(
        () => false,
        () => true,
      );
    await store.clear();
    assert(
      await delayed,
      "Reset rejects an older save still preparing in resumable slices",
    );
    assert(
      (await store.load()) === undefined &&
        (await store.baseline())?.world.seed === baseline.world.seed,
      "Reset clears damage while retaining the exact island",
    );
    return checks;
  } finally {
    store.close();
  }
}
