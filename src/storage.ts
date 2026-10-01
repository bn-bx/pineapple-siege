import { normalizePreferences } from "./preferences";
import { NUKE_LIMITS } from "./destruction-settings";
import type { SaveSnapshot, Preferences } from "./types";
import { CONFIG, DEFAULT_MONSTER_COUNT, MAX_MONSTER_COUNT } from "./config";
export class SaveStore {
  private db?: IDBDatabase;
  async open() {
    return new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("lantern-vale", 1);
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
  async load(): Promise<SaveSnapshot | undefined> {
    return new Promise((resolve, reject) => {
      if (!this.db) return reject(new Error("Storage is not available"));
      const r = this.db
        .transaction("worlds")
        .objectStore("worlds")
        .get("current");
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }
  async write(save: SaveSnapshot) {
    return new Promise<void>((resolve, reject) => {
      if (!this.db) return reject(new Error("Storage is not available"));
      const tx = this.db.transaction("worlds", "readwrite");
      tx.objectStore("worlds").put(save, "current");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("Save interrupted"));
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
    return new Promise<void>((resolve, reject) => {
      if (!this.db) return reject(new Error("Storage is not available"));
      const tx = this.db.transaction("worlds", "readwrite");
      tx.objectStore("worlds").delete("current");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
}
export function compatible(
  save: unknown,
  worldVersion: number,
  seed: number,
): save is SaveSnapshot {
  if (!save || typeof save !== "object") return false;
  const s = save as SaveSnapshot;
  return (
    s.version === CONFIG.version &&
    s.worldVersion === worldVersion &&
    s.seed === seed &&
    Number.isFinite(s.hour) &&
    Number.isFinite(s.laserCooldown) &&
    s.laserCooldown >= 0 &&
    s.laserDry instanceof Uint32Array &&
    s.laserDry.every((i) => i < 1025 * 1025) &&
    Array.isArray(s.vaporized) &&
    s.vaporized.every(Number.isInteger) &&
    (s.monsters === undefined ||
      (Array.isArray(s.monsters) &&
        s.monsters.length >= DEFAULT_MONSTER_COUNT &&
        s.monsters.length <= MAX_MONSTER_COUNT &&
        s.monsters.every(
          (m, id) =>
            m &&
            m.id === id &&
            validPoint(m.p) &&
            Number.isFinite(m.yaw) &&
            Number.isFinite(m.health) &&
            m.health >= 0 &&
            m.health <= 3 &&
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
            l.pending.every((i) => Number.isInteger(i) && i >= 0 && i < 1024))),
    ) &&
    Array.isArray(s.laserWork) &&
    s.laserWork.every(
      (w) =>
        w &&
        Number.isInteger(w.section) &&
        w.section >= 0 &&
        w.section < 1024 &&
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
        j.chunks.every((i) => Number.isInteger(i) && i >= 0 && i < 1024) &&
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
      data.length <= 1025 * 1025 * 2 &&
      data.length % 2 === 0 &&
      data.every((v, i) =>
        i % 2
          ? Number.isFinite(v)
          : Number.isInteger(v) && v >= 0 && v < 1025 * 1025,
      )
    );
  return (
    Array.isArray(data) &&
    data.length <= 1025 * 1025 &&
    data.every(
      (p) =>
        Array.isArray(p) &&
        Number.isInteger(p[0]) &&
        p[0] >= 0 &&
        p[0] < 1025 * 1025 &&
        Number.isFinite(p[1]),
    )
  );
}
