import { FIRE_LIMIT, FIRE_LIFETIME } from "./sim/nuclear-fire";
import { unpackBodies } from "./sim/body-buffer";
import { consolidateRubble } from "./sim/rubble";
import { isRoof, roofClearance } from "./debris-shape";
import { orientedSize } from "./sim/ballistic-debris";
import { RUBBLE_LIMITS } from "./destruction-settings";
import { validateIsland, GENERATOR_VERSION } from "./world/generator.mjs";
import type { IslandBaseline } from "./world/generator.mjs";
import { normalizePreferences } from "./preferences";
import { NUKE_LIMITS } from "./destruction-settings";
import type { SaveSnapshot, SaveSection, Preferences } from "./types";
import { CONFIG, CHUNKS, MAX_MONSTER_COUNT } from "./config";
import type { DamageWriter } from "./save-writer";
export class SaveStore {
  private worldEpoch = 0;
  private writes = new Set<IDBTransaction>();
  constructor(
    private name = "lantern-vale",
    private writer?: DamageWriter,
  ) {}
  retirePendingWrites() {
    this.worldEpoch++;
    for (const transaction of this.writes) {
      try {
        transaction.abort();
      } catch {
        /* already completed */
      }
    }
    this.writes.clear();
  }
  close() {
    this.retirePendingWrites();
    this.writer?.close();
    this.db?.close();
    this.db = undefined;
  }
  private acceptedBaseline?: IslandBaseline;
  private db?: IDBDatabase;
  async open() {
    return new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(this.name, 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore("worlds");
      request.onsuccess = () => {
        this.db = request.result;
        this.db.onversionchange = () => this.db?.close();
        resolve();
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () =>
        reject(new Error("Another tab is blocking local storage."));
    });
  }
  async baseline(): Promise<IslandBaseline | undefined> {
    const value = await new Promise<IslandBaseline | undefined>(
      (resolve, reject) => {
        if (!this.db) return reject(Error("Storage is not available"));
        const r = this.db
          .transaction("worlds")
          .objectStore("worlds")
          .get("baseline");
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      },
    );
    if (value) validateIsland(value.world, value.heights);
    this.acceptedBaseline = value;
    return value;
  }
  async replaceBaseline(baseline: IslandBaseline) {
    validateIsland(baseline.world, baseline.heights);
    this.retirePendingWrites();
    await this.writer?.retire();
    return new Promise<void>((resolve, reject) => {
      if (!this.db) return reject(Error("Storage is not available"));
      const tx = this.db.transaction("worlds", "readwrite"),
        objects = tx.objectStore("worlds");
      objects.put(baseline, "baseline");
      objects.delete("current");
      this.deleteSections(objects);
      tx.oncomplete = () => {
        this.acceptedBaseline = baseline;
        resolve();
      };
      tx.onerror = () => reject(tx.error);
      tx.onabort = () =>
        reject(tx.error ?? Error("Island replacement interrupted"));
    });
  }
  private deleteSections(objects: IDBObjectStore, done?: () => void) {
    const cursor = objects.openCursor(
      IDBKeyRange.bound("section:", "section;"),
    );
    cursor.onsuccess = () => {
      const c = cursor.result;
      if (c) {
        c.delete();
        c.continue();
      } else done?.();
    };
  }
  async load(): Promise<SaveSnapshot | undefined> {
    if (!this.db) throw Error("Storage is not available");
    const objects = this.db.transaction("worlds").objectStore("worlds");
    const get = (request: IDBRequest) =>
      new Promise<any>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    const [save, sections] = (await Promise.all([
      get(objects.get("current")),
      get(objects.getAll(IDBKeyRange.bound("section:", "section;"))),
    ])) as [SaveSnapshot | undefined, SaveSection[]];
    if (!save) return;
    if (save.sectioned) {
      if (!sections.every(validSection))
        throw Error(
          "Saved island sections are invalid; the original save remains protected",
        );
      const terrain = new Float32Array(
          sections.reduce((n, s) => n + s.terrain.length, 0),
        ),
        dry = new Uint32Array(sections.reduce((n, s) => n + s.dry.length, 0));
      const ruins = new Map(save.ruins.map((r) => [r.id, r]));
      let t = 0,
        d = 0;
      for (const s of sections) {
        terrain.set(s.terrain, t);
        t += s.terrain.length;
        dry.set(s.dry, d);
        d += s.dry.length;
        for (const r of s.ruins) ruins.set(r.id, r);
      }
      if (save.moving?.count) {
        const baseline = this.acceptedBaseline ?? (await this.baseline());
        if (!baseline)
          throw Error("Saved moving debris is missing its island baseline");
        const edits = new Map<number, number>();
        for (let i = 0; i < terrain.length; i += 2)
          edits.set(terrain[i], terrain[i + 1]);
        const sample = (x: number, z: number) => {
          const gx = Math.max(0, Math.min(CONFIG.grid - 1.00001, x / 2)),
            gz = Math.max(0, Math.min(CONFIG.grid - 1.00001, z / 2)),
            ix = Math.floor(gx),
            iz = Math.floor(gz),
            i = iz * CONFIG.grid + ix,
            u = gx - ix,
            v = gz - iz;
          const h = (i: number) => edits.get(i) ?? baseline.heights[i],
            a = h(i),
            b = h(i + 1),
            c = h(i + CONFIG.grid),
            d = h(i + CONFIG.grid + 1);
          return u + v <= 1
            ? a + (b - a) * u + (c - a) * v
            : d + (c - d) * (1 - u) + (b - d) * (1 - v);
        };
        const cells = new Map<number, Set<number>>();
        const cell = (p: number[]) =>
          Math.floor(p[2] / 64) * CHUNKS + Math.floor(p[0] / 64);
        for (const r of ruins.values()) {
          const key = cell(r.p);
          let set = cells.get(key);
          if (!set) cells.set(key, (set = new Set()));
          set.add(r.id);
        }
        for (const view of unpackBodies(save.moving)) {
          const p: [number, number, number] = [
              Math.max(8, Math.min(CONFIG.worldSize - 8, view.p[0])),
              0,
              Math.max(8, Math.min(CONFIG.worldSize - 8, view.p[2])),
            ],
            s: [number, number, number] = [...view.s];
          let q: [number, number, number, number] = [...view.q];
          if (view.kind === "tree") {
            s[0] = view.s[1];
            s[1] = 0.8;
            s[2] = 0.8;
            q = [0, 0, 0, 1];
          }
          p[1] =
            sample(p[0], p[2]) +
            (isRoof(view.material)
              ? roofClearance(s, q, view.roofPart)
              : orientedSize(s, q)[1]);
          let r: SaveSnapshot["ruins"][number] = {
            ...view,
            p,
            s,
            q,
            kind: "chunk",
          };
          const key = cell(p);
          let set = cells.get(key);
          if (!set) cells.set(key, (set = new Set()));
          if (set.size >= RUBBLE_LIMITS[save.destruction?.rubble ?? 1]) {
            const merged = consolidateRubble(
              r,
              [...set].map((id) => ruins.get(id)!),
              sample,
            );
            ruins.delete(merged.removed);
            set.delete(merged.removed);
            if (merged.ruin.id !== r.id) ruins.set(merged.ruin.id, merged.ruin);
            else r = merged.ruin;
          }
          ruins.set(r.id, r);
          set.add(r.id);
        }
      }
      return {
        ...save,
        terrain,
        laserDry: dry,
        ruins: [...ruins.values()],
        moving: undefined,
        sectioned: undefined,
      };
    }
    if (
      save.version === 8 &&
      compatible(
        save,
        save.worldVersion,
        save.seed,
        (this.acceptedBaseline ?? (await this.baseline()))?.world
          .generatorVersion,
      )
    ) {
      const migrated = { ...save, version: CONFIG.version };
      // Original record remains untouched if any request or commit fails.
      try {
        await this.write(migrated);
        return migrated;
      } catch {
        return save;
      }
    }
    return save;
  }
  async write(save: SaveSnapshot) {
    if (!this.db) throw Error("Storage is not available");
    if (this.writer) return this.writer.write(save);
    const epoch = this.worldEpoch;
    let sections = save.sections;
    if (!save.incremental) {
      const groups = new Map<
        number,
        { terrain: number[]; dry: number[]; ruins: SaveSnapshot["ruins"] }
      >();
      const group = (id: number) => {
        let g = groups.get(id);
        if (!g) groups.set(id, (g = { terrain: [], dry: [], ruins: [] }));
        return g;
      };
      const sampleSection = (i: number) =>
        Math.min(CHUNKS - 1, Math.floor(i / CONFIG.grid / 32)) * CHUNKS +
        Math.min(CHUNKS - 1, Math.floor((i % CONFIG.grid) / 32));
      if (save.terrain instanceof Float32Array)
        for (let i = 0; i < save.terrain.length; i += 2)
          group(sampleSection(save.terrain[i])).terrain.push(
            save.terrain[i],
            save.terrain[i + 1],
          );
      else
        for (const [i, h] of save.terrain)
          group(sampleSection(i)).terrain.push(i, h);
      for (const i of save.laserDry) group(sampleSection(i)).dry.push(i);
      for (const r of save.ruins)
        group(
          Math.floor(r.p[2] / 64) * CHUNKS + Math.floor(r.p[0] / 64),
        ).ruins.push(r);
      sections = [...groups].map(([id, g]) => ({
        id,
        terrain: new Float32Array(g.terrain),
        dry: new Uint32Array(g.dry),
        ruins: g.ruins,
        removedRuins: [],
      }));
    }
    let validationStarted = performance.now();
    for (const section of sections ?? []) {
      if (!validSection(section))
        throw Error("Invalid incremental save section");
      if (performance.now() - validationStarted >= 1) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        validationStarted = performance.now();
      }
    }
    if (epoch !== this.worldEpoch || !this.db)
      throw Error("World changed before save preparation completed");
    const header: SaveSnapshot = {
      ...save,
      sectioned: true,
      incremental: undefined,
      capture: undefined,
      sections: undefined,
      terrain: new Float32Array(),
      laserDry: new Uint32Array(),
      ruins: save.incremental ? save.ruins : [],
    };
    return new Promise<void>((resolve, reject) => {
      const tx = this.db!.transaction("worlds", "readwrite"),
        objects = tx.objectStore("worlds");
      this.writes.add(tx);
      const writeRecords = () => {
        for (const section of sections ?? []) {
          if (!save.incremental) {
            objects.put(section, "section:" + section.id);
            continue;
          }
          const request = objects.get("section:" + section.id);
          request.onsuccess = () => {
            try {
              const old = request.result as SaveSection | undefined;
              const terrain = new Map<number, number>(),
                dry = new Set(old?.dry),
                ruins = new Map(old?.ruins.map((r) => [r.id, r]));
              if (old)
                for (let i = 0; i < old.terrain.length; i += 2)
                  terrain.set(old.terrain[i], old.terrain[i + 1]);
              for (let i = 0; i < section.terrain.length; i += 2)
                terrain.set(section.terrain[i], section.terrain[i + 1]);
              for (const i of section.dry) dry.add(i);
              for (const id of section.removedRuins) ruins.delete(id);
              for (const r of section.ruins) ruins.set(r.id, r);
              const packed = new Float32Array(terrain.size * 2);
              let i = 0;
              for (const [index, h] of terrain) {
                packed[i++] = index;
                packed[i++] = h;
              }
              objects.put(
                {
                  id: section.id,
                  terrain: packed,
                  dry: Uint32Array.from(dry),
                  ruins: [...ruins.values()],
                  removedRuins: [],
                },
                "section:" + section.id,
              );
            } catch (error) {
              tx.abort();
              reject(error);
            }
          };
        }
        objects.put(header, "current");
      };
      const commit = () => {
        try {
          writeRecords();
        } catch (error) {
          tx.abort();
          reject(error);
        }
      };
      if (save.incremental) commit();
      else this.deleteSections(objects, commit);
      tx.oncomplete = () => {
        this.writes.delete(tx);
        resolve();
      };
      tx.onerror = () => {
        this.writes.delete(tx);
        reject(tx.error);
      };
      tx.onabort = () => {
        this.writes.delete(tx);
        reject(tx.error || Error("Save interrupted"));
      };
    });
  }
  async preferences(): Promise<Preferences | undefined> {
    return new Promise((resolve, reject) => {
      if (!this.db) return resolve(undefined);
      const r = this.db
        .transaction("worlds")
        .objectStore("worlds")
        .get("preferences");
      r.onerror = () => reject(r.error);
      r.onsuccess = () => {
        const v = r.result;
        resolve(normalizePreferences(v && typeof v === "object" ? v : {}));
      };
    });
  }
  async writePreferences(value: Preferences) {
    return new Promise<void>((resolve, reject) => {
      if (!this.db) return reject(new Error("Storage unavailable"));
      const tx = this.db.transaction("worlds", "readwrite");
      tx.objectStore("worlds").put(value, "preferences");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }
  async clear() {
    this.retirePendingWrites();
    await this.writer?.retire();
    return new Promise<void>((resolve, reject) => {
      if (!this.db) return reject(new Error("Storage is not available"));
      const tx = this.db.transaction("worlds", "readwrite");
      tx.objectStore("worlds").delete("current");
      this.deleteSections(tx.objectStore("worlds"));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
}
export function compatible(
  save: unknown,
  worldVersion: number,
  seed: number,
  generatorVersion = GENERATOR_VERSION,
): save is SaveSnapshot {
  if (!save || typeof save !== "object") return false;
  const s = save as SaveSnapshot;
  return (
    validNuclearFire(s.nuclearFire) &&
    (s.version === CONFIG.version || s.version === 8) &&
    s.worldVersion === worldVersion &&
    s.seed === seed &&
    (worldVersion < 8 || s.generatorVersion === generatorVersion) &&
    (s.supportJobs === undefined ||
      (Array.isArray(s.supportJobs) &&
        s.supportJobs.every(
          (j) =>
            j &&
            typeof j.name === "string" &&
            validPoint(j.origin) &&
            Number.isFinite(j.coarse) &&
            j.coarse > 0 &&
            Number.isFinite(j.budget) &&
            Number.isInteger(j.cursor) &&
            j.cursor >= 0 &&
            ["foundations", "links", "falling", "emit"].includes(j.phase) &&
            [j.alive, j.connected].every(
              (ids) =>
                Array.isArray(ids) &&
                ids.every((id) => Number.isInteger(id) && id >= 0),
            ) &&
            Array.isArray(j.clusters) &&
            j.clusters.every(
              (ids) =>
                Array.isArray(ids) &&
                ids.every((id) => Number.isInteger(id) && id >= 0),
            ) &&
            (j.ownerSeed === undefined || Number.isFinite(j.ownerSeed)),
        ))) &&
    (s.moving === undefined ||
      (s.moving.buffer instanceof ArrayBuffer &&
        Number.isInteger(s.moving.count) &&
        s.moving.count >= 0 &&
        s.moving.buffer.byteLength >= s.moving.count * 50)) &&
    Number.isFinite(s.hour) &&
    Number.isFinite(s.laserCooldown) &&
    s.laserCooldown >= 0 &&
    s.laserDry instanceof Uint32Array &&
    s.laserDry.every((i) => i < CONFIG.grid * CONFIG.grid) &&
    (s.civilians === undefined ||
      (Array.isArray(s.civilians) &&
        s.civilians.length <= 1000 &&
        s.civilians.every(
          (c, id) =>
            c &&
            c.id === id &&
            validPoint(c.p) &&
            typeof c.alive === "boolean" &&
            ["walk", "flee", "cheer", "sad"].includes(c.mood) &&
            Number.isFinite(c.yaw) &&
            Number.isFinite(c.phase) &&
            c.phase >= 0,
        ))) &&
    (s.settlements === undefined ||
      (Array.isArray(s.settlements) &&
        s.settlements.length <= 100 &&
        s.settlements.every(
          (s) =>
            s &&
            typeof s.id === "string" &&
            typeof s.threatened === "boolean" &&
            Number.isFinite(s.cheer) &&
            s.cheer >= 0 &&
            s.cheer <= 6 &&
            Number.isFinite(s.sad) &&
            s.sad >= 0 &&
            s.sad <= 10,
        ))) &&
    Array.isArray(s.vaporized) &&
    s.vaporized.every(Number.isInteger) &&
    (s.flies === undefined ||
      (Array.isArray(s.flies) &&
        s.flies.length === 6 &&
        s.flies.every(
          (f, id) =>
            f &&
            f.id === id &&
            validPoint(f.p) &&
            Array.isArray(f.v) &&
            f.v.length === 3 &&
            f.v.every(Number.isFinite) &&
            [f.yaw, f.pitch, f.roll, f.timer, f.deathAge, f.phase].every(
              Number.isFinite,
            ) &&
            Number.isInteger(f.health) &&
            f.health >= 0 &&
            f.health <= 3 &&
            typeof f.defeated === "boolean" &&
            f.defeated === (f.health === 0) &&
            f.timer >= 0 &&
            f.deathAge >= 0 &&
            ["roam", "chase", "windup", "lunge", "recovery"].includes(f.mode),
        ))) &&
    (s.monsters === undefined ||
      (Array.isArray(s.monsters) &&
        s.monsters.length <= MAX_MONSTER_COUNT &&
        s.monsters.every(
          (m, id) =>
            m &&
            m.id === id &&
            validPoint(m.p) &&
            Number.isFinite(m.yaw) &&
            Number.isFinite(m.health) &&
            m.health >= 0 &&
            m.health <= 5 &&
            typeof m.defeated === "boolean" &&
            Number.isFinite(m.phase) &&
            Number.isFinite(m.windup) &&
            Number.isFinite(m.stagger),
        ))) &&
    Array.isArray(s.laserSupport) &&
    s.laserSupport.every((a) => typeof a === "string") &&
    Array.isArray(s.lasers) &&
    s.lasers.every(
      (l) =>
        l &&
        Number.isInteger(l.id) &&
        l.id > 0 &&
        validPoint(l.p) &&
        Number.isFinite(l.age) &&
        l.age >= 0 &&
        ["charging", "burning", "finishing"].includes(l.phase) &&
        (l.pending === undefined ||
          (Array.isArray(l.pending) &&
            l.pending.every(
              (i) => Number.isInteger(i) && i >= 0 && i < CHUNKS * CHUNKS,
            ))),
    ) &&
    Array.isArray(s.laserWork) &&
    s.laserWork.every(
      (w) =>
        w &&
        Number.isInteger(w.section) &&
        w.section >= 0 &&
        w.section < CHUNKS * CHUNKS &&
        Array.isArray(w.targets) &&
        w.targets.every(
          (t) =>
            t &&
            validPoint(t.p) &&
            Number.isFinite(t.progress) &&
            t.progress >= 0 &&
            t.progress <= 1,
        ),
    ) &&
    Array.isArray(s.pendingJobs) &&
    s.pendingJobs.every(
      (j) =>
        j &&
        ["local", "castle", "valley"].includes(j.yield) &&
        ["terrain", "entities", "support"].includes(j.phase) &&
        Array.isArray(j.p) &&
        j.p.length === 3 &&
        j.p.every(Number.isFinite) &&
        Number.isInteger(j.cursor) &&
        j.cursor >= 0 &&
        Array.isArray(j.chunks) &&
        j.chunks.every(
          (i) => Number.isInteger(i) && i >= 0 && i < CHUNKS * CHUNKS,
        ) &&
        Array.isArray(j.entities) &&
        j.entities.every(Number.isInteger) &&
        Array.isArray(j.assemblies) &&
        j.assemblies.every((a) => typeof a === "string") &&
        Number.isFinite(j.fragments) &&
        Number.isFinite(j.seed) &&
        Number.isFinite(j.excavation) &&
        j.excavation >= 0 &&
        j.excavation <= 1 &&
        !!j.profile &&
        Object.values(j.profile).every((v) => Number.isFinite(v) && v >= 0) &&
        j.profile.bodyLimit <= Math.max(...NUKE_LIMITS) &&
        Array.isArray(j.supportQueue) &&
        j.supportQueue.every(
          (ids) => Array.isArray(ids) && ids.every(Number.isInteger),
        ),
    ) &&
    validTerrain(s.terrain) &&
    Array.isArray(s.removed) &&
    s.removed.every(Number.isInteger) &&
    Array.isArray(s.ruins) &&
    s.ruins.every(
      (r) =>
        r &&
        [
          "stone",
          "wood",
          "foliage",
          "earth",
          "rock",
          "plaster",
          "roof",
          "sandstone",
          "slate",
          "window",
        ].includes(r.material) &&
        ["chunk", "tree", "rock"].includes(r.kind) &&
        Number.isInteger(r.id) &&
        Number.isInteger(r.source) &&
        (r.volume === undefined ||
          (Number.isFinite(r.volume) && r.volume > 0)) &&
        (r.pile === undefined || typeof r.pile === "boolean") &&
        Array.isArray(r.p) &&
        r.p.length === 3 &&
        r.p.every(Number.isFinite) &&
        Array.isArray(r.s) &&
        r.s.length === 3 &&
        r.s.every((v) => Number.isFinite(v) && v > 0) &&
        Array.isArray(r.q) &&
        r.q.length === 4 &&
        r.q.every(Number.isFinite),
    )
  );
}
function validNuclearFire(f: SaveSnapshot["nuclearFire"]) {
  if (f === undefined) return true;
  if (
    !f ||
    !Number.isFinite(f.clock) ||
    f.clock < 0 ||
    !Number.isFinite(f.creatureClock) ||
    f.creatureClock < 0 ||
    f.creatureClock >= 1 ||
    !Array.isArray(f.patches) ||
    f.patches.length > FIRE_LIMIT ||
    !Array.isArray(f.exposures) ||
    f.exposures.length > 100000
  )
    return false;
  const ids = new Set<number>();
  for (const p of f.patches) {
    if (
      !p ||
      !Number.isSafeInteger(p.id) ||
      p.id < 1 ||
      ids.has(p.id) ||
      !validPoint(p.p) ||
      p.p[0] < 0 ||
      p.p[2] < 0 ||
      p.p[0] > CONFIG.worldSize ||
      p.p[2] > CONFIG.worldSize ||
      !Number.isFinite(p.radius) ||
      p.radius < 12 ||
      p.radius > 24 ||
      !Number.isFinite(p.height) ||
      p.height < 6 ||
      p.height > 12 ||
      !Number.isFinite(p.age) ||
      p.age < 0 ||
      p.age >= FIRE_LIFETIME ||
      !Number.isFinite(p.seed)
    )
      return false;
    ids.add(p.id);
  }
  const entities = new Set<number>();
  return f.exposures.every((e) => {
    if (
      !Array.isArray(e) ||
      e.length !== 3 ||
      !Number.isSafeInteger(e[0]) ||
      e[0] < 0 ||
      entities.has(e[0]) ||
      !Number.isFinite(e[1]) ||
      e[1] < 0 ||
      e[1] > 5 ||
      !Number.isFinite(e[2]) ||
      e[2] < 0 ||
      e[2] > f.clock
    )
      return false;
    entities.add(e[0]);
    return true;
  });
}
function validPoint(p: unknown): boolean {
  return (
    Array.isArray(p) &&
    p.length === 3 &&
    p.every(Number.isFinite) &&
    p[0] >= 0 &&
    p[0] <= CONFIG.worldSize &&
    p[2] >= 0 &&
    p[2] <= CONFIG.worldSize
  );
}
function validTerrain(data: SaveSnapshot["terrain"]) {
  if (data instanceof Float32Array)
    return (
      data.length <= CONFIG.grid * CONFIG.grid * 2 &&
      data.length % 2 === 0 &&
      data.every((v, i) =>
        i % 2
          ? Number.isFinite(v)
          : Number.isInteger(v) && v >= 0 && v < CONFIG.grid * CONFIG.grid,
      )
    );
  return (
    Array.isArray(data) &&
    data.length <= CONFIG.grid * CONFIG.grid &&
    data.every(
      (p) =>
        Array.isArray(p) &&
        Number.isInteger(p[0]) &&
        p[0] >= 0 &&
        p[0] < CONFIG.grid * CONFIG.grid &&
        Number.isFinite(p[1]),
    )
  );
}

function validSection(section: SaveSection) {
  if (
    !section ||
    !Number.isInteger(section.id) ||
    section.id < 0 ||
    section.id >= CHUNKS * CHUNKS ||
    !(section.terrain instanceof Float32Array) ||
    !(section.dry instanceof Uint32Array) ||
    !Array.isArray(section.ruins) ||
    !Array.isArray(section.removedRuins) ||
    !validTerrain(section.terrain)
  )
    return false;
  const belongs = (i: number) =>
    i >= 0 &&
    i < CONFIG.grid * CONFIG.grid &&
    Math.min(CHUNKS - 1, Math.floor(i / CONFIG.grid / 32)) * CHUNKS +
      Math.min(CHUNKS - 1, Math.floor((i % CONFIG.grid) / 32)) ===
      section.id;
  for (let i = 0; i < section.terrain.length; i += 2)
    if (!belongs(section.terrain[i])) return false;
  return (
    section.dry.every(belongs) && section.removedRuins.every(Number.isInteger)
  );
}
