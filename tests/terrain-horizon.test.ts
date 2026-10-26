import { afterEach, expect, it, vi } from "vitest";
import * as THREE from "three";
import { CONFIG, CHUNKS } from "../src/config";
import { TerrainView } from "../src/render/terrain-view";
import { terrainRoadWeights } from "../src/render/terrain-colors";
import {
  terrainDetailStep,
  terrainPathDistance,
} from "../src/render/terrain-lod";
import type { WorldData } from "../src/types";
import type {
  TerrainJob,
  TerrainResult,
} from "../src/render/terrain-mesh-worker";

const world = {
  paths: [],
  castleBounds: { min: [-10, -10], max: [-5, -5] },
  spawn: [-10000, 0, -10000],
} as unknown as WorldData;
it("blends packed earth through a feathered road verge without a hard edge", () => {
  expect(terrainRoadWeights(0)[0]).toBe(1);
  expect(terrainRoadWeights(2.7)[0]).toBeGreaterThan(0);
  expect(terrainRoadWeights(3.3)[0]).toBe(0);
  expect(terrainRoadWeights(3.3)[1]).toBeGreaterThan(0);
  expect(terrainRoadWeights(6.2)[1]).toBe(0);
  expect(
    Math.abs(terrainRoadWeights(3.19)[1] - terrainRoadWeights(3.21)[1]),
  ).toBeLessThan(0.01);
});
function create() {
  return new TerrainView(
    world,
    new Float32Array(CONFIG.grid * CONFIG.grid).fill(80),
    new THREE.Texture(),
  );
}
function coarse(view: TerrainView) {
  return view.group.children.find(
    (c) =>
      (c as THREE.Mesh).geometry?.getAttribute("position")?.count ===
      (CHUNKS + 1) ** 2,
  ) as THREE.Mesh;
}
function covered(mesh: THREE.Mesh, chunk: number) {
  return Array.from(
    mesh.geometry.index!.array.slice(chunk * 6, chunk * 6 + 6),
  ).every((n) => n === 0);
}
class WorkerStub {
  static last: WorkerStub;
  onmessage?: (e: { data: TerrainResult }) => void;
  onerror?: (e: unknown) => void;
  jobs: TerrainJob[] = [];
  constructor() {
    WorkerStub.last = this;
  }
  postMessage(m: { type: string; job: TerrainJob }) {
    if (m.type === "mesh") this.jobs.push(m.job);
  }
  terminate() {}
  complete(job: TerrainJob) {
    this.onmessage?.({
      data: {
        epoch: job.epoch,
        tile: job.tile,
        serial: job.serial,
        buildMS: 0,
        members: job.sections.map((s) => ({
          id: s.id,
          step: s.step,
          revision: s.revision,
        })),
        position: new Float32Array([0, 80, 0, 256, 80, 0, 0, 80, 256]),
        normal: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]),
        color: new Float32Array(9).fill(0.3),
        uv: new Float32Array(6),
        index: new Uint16Array([0, 2, 1]),
        sphere: [128, 80, 128, 182],
      },
    });
  }
}
afterEach(() => vi.unstubAllGlobals());

it("blends the first detailed tile from its backdrop and applies edits without waiting for the fade", () => {
  vi.stubGlobal("Worker", WorkerStub);
  const view = create(),
    worker = WorkerStub.last,
    runtime = view as any;
  const camera = new THREE.Vector3(128, 100, 128);
  try {
    view.update(camera, 600, 0);
    const job = worker.jobs[0];
    worker.complete(job);
    view.update(camera, 600, 0);
    const tile = runtime.tiles.get(job.tile);
    expect(runtime.transitions.active(job.tile)).toBe(true);
    expect(tile.mesh.geometry.getAttribute("terrainBlend").getY(0)).toBe(1);
    const previous = view.group.children.find((child) => {
      const geometry = (child as THREE.Mesh).geometry;
      return geometry?.getAttribute("terrainBlend")?.getY(0) === -1;
    }) as THREE.Mesh;
    expect(previous.geometry.getAttribute("position").getY(0)).toBe(79);
    const disposal = vi.spyOn(previous.geometry, "dispose");
    view.patch({
      indices: new Uint32Array(),
      values: new Float32Array(),
      chunks: [job.sections[0].id],
    });
    worker.complete({
      ...job,
      sections: job.sections.map((s, i) => ({
        ...s,
        revision: i === 0 ? 1 : 0,
      })),
    });
    view.update(camera, 600, 0);
    expect(runtime.transitions.active(job.tile)).toBe(false);
    expect(tile.mesh.geometry.getAttribute("terrainBlend").getY(0)).toBe(0);
    expect(disposal).toHaveBeenCalledOnce();
  } finally {
    view.dispose();
  }
});

it("does not resubmit installed or completed terrain when a temporary detail change has already resolved", () => {
  vi.stubGlobal("Worker", WorkerStub);
  const view = create(),
    worker = WorkerStub.last,
    runtime = view as any;
  const camera = new THREE.Vector3(128, 100, 128);
  try {
    view.update(camera, 600, 0);
    view.update(camera, 600, 0);
    const [first, second] = worker.jobs;
    // A request can become dirty while running, then match the target again.
    runtime.dirtyTiles.add(first.tile);
    runtime.dirtyTiles.add(second.tile);
    worker.complete(first);
    worker.complete(second);
    view.update(camera, 600, 0);
    expect(runtime.dirtyTiles.has(first.tile)).toBe(false);
    expect(runtime.completedTiles.has(second.tile)).toBe(true);
    expect(
      worker.jobs
        .slice(2)
        .some((j) => j.tile === first.tile || j.tile === second.tile),
    ).toBe(false);
    view.update(camera, 600, 0);
    expect(runtime.dirtyTiles.has(second.tile)).toBe(false);
    expect(runtime.completedTiles.size).toBe(0);
    view.restore(view.heights);
    expect(runtime.completedTiles.size).toBe(0);
  } finally {
    view.dispose();
  }
});

it("prepares nearby terrain before startup warmup finishes", async () => {
  class CompletingWorker extends WorkerStub {
    postMessage(m: { type: string; job: TerrainJob }) {
      super.postMessage(m);
      if (m.type === "mesh") queueMicrotask(() => this.complete(m.job));
    }
  }
  vi.stubGlobal("Worker", CompletingWorker);
  const view = create();
  try {
    await view.prewarm(new THREE.Vector3(128, 100, 128), 600);
    expect(view.chunks[2 * CHUNKS + 2].step).toBe(2);
    expect(view.chunks[2 * CHUNKS + 2].dirty).toBe(false);
    expect((view as any).tiles.size).toBeGreaterThan(0);
  } finally {
    view.dispose();
  }
});

it("prepares terrain along the flight path without widening the detail radius", () => {
  const camera = new THREE.Vector3(128, 100, 128);
  const predicted = new THREE.Vector3(488, 100, 128);
  expect(terrainPathDistance(308, 228, camera, predicted)).toBe(100);
  expect(terrainPathDistance(28, 128, camera, predicted)).toBe(100);
  expect(terrainPathDistance(588, 128, camera, predicted)).toBe(100);
  expect(terrainDetailStep(220, 4)).toBe(2);
  expect(terrainDetailStep(250, 2)).toBe(2);
  expect(terrainDetailStep(280, 2)).toBe(4);
  expect(terrainDetailStep(2000)).toBe(16);

  vi.stubGlobal("Worker", WorkerStub);
  const view = create();
  try {
    view.update(camera, 1200, 0);
    const runtime = view as any;
    const ahead = 2 * CHUNKS + 8; // (544, 160), ahead of the aircraft.
    expect(runtime.requestedSteps[ahead]).toBe(4);
    // Changing velocity in the same camera cell must also update requested LOD.
    view.update(camera, 1200, 0, 1, [240, 0, 0]);
    expect(runtime.requestedSteps[ahead]).toBe(2);
    expect(runtime.requestedSteps[2 * CHUNKS + 4]).toBe(2);
  } finally {
    view.dispose();
  }
});

it("installs a usable in-flight mesh after movement changes LOD, then requests refinement", () => {
  vi.stubGlobal("Worker", WorkerStub);
  const view = create(),
    worker = WorkerStub.last,
    runtime = view as any;
  try {
    view.update(new THREE.Vector3(128, 100, 128), 600, 0);
    const job = worker.jobs[0];
    view.update(new THREE.Vector3(700, 100, 128), 600, 0);
    expect(
      job.sections.some((s) => runtime.requestedSteps[s.id] !== s.step),
    ).toBe(true);
    worker.complete(job);
    expect(runtime.completed).toHaveLength(1);
    view.update(new THREE.Vector3(700, 100, 128), 600, 0);
    expect(runtime.tiles.has(job.tile)).toBe(true);
    expect(covered(coarse(view), job.sections[0].id)).toBe(true);
    expect(
      runtime.dirtyTiles.has(job.tile) || runtime.inFlight.has(job.tile),
    ).toBe(true);
    // New edits still invalidate an old result, even when its LOD is usable.
    const pending = worker.jobs.find((j) => j.tile !== job.tile)!;
    view.patch({
      indices: new Uint32Array(),
      values: new Float32Array(),
      chunks: [pending.sections[0].id],
    });
    worker.complete(pending);
    expect(runtime.completed).toHaveLength(0);
  } finally {
    view.dispose();
  }
});

it("shows partial detail upgrades without replacing a current surface with a downgrade", () => {
  vi.stubGlobal("Worker", WorkerStub);
  const view = create(),
    worker = WorkerStub.last,
    runtime = view as any;
  const camera = new THREE.Vector3(128, 100, 128);
  try {
    view.update(camera, 600, 0);
    const job = worker.jobs[0];
    const atStep = (step: number) => ({
      ...job,
      sections: job.sections.map((s) => ({ ...s, step })),
    });
    // The camera wants step 2, but step 8 is ready first and fills the backdrop.
    worker.complete(atStep(8));
    view.update(camera, 600, 0);
    const tile = runtime.tiles.get(job.tile);
    const coarseGeometry = tile.mesh.geometry;
    // A second LOD waits until the current handover finishes.
    runtime.transitions.update(performance.now() / 1000 + 1);
    expect(view.chunks[job.sections[0].id].step).toBe(8);
    worker.complete(atStep(4));
    view.update(camera, 600, 0);
    expect(tile.mesh.geometry).not.toBe(coarseGeometry);
    expect(view.chunks[job.sections[0].id].step).toBe(4);
    const improvedGeometry = tile.mesh.geometry;
    runtime.transitions.update(performance.now() / 1000 + 1);
    worker.complete(atStep(8));
    view.update(camera, 600, 0);
    expect(tile.mesh.geometry).toBe(improvedGeometry);
    expect(
      runtime.dirtyTiles.has(job.tile) || runtime.inFlight.has(job.tile),
    ).toBe(true);
  } finally {
    view.dispose();
  }
});

it("restores horizon coverage on tile detach, cached reattach and worker failure", () => {
  vi.stubGlobal("Worker", WorkerStub);
  const view = create(),
    mesh = coarse(view),
    worker = WorkerStub.last;
  const camera = new THREE.Vector3(128, 100, 128);
  view.update(camera, 600, 100);
  const job = worker.jobs[0];
  worker.complete(job);
  view.update(camera, 600, 100);
  expect(covered(mesh, job.sections[0].id)).toBe(true);
  view.update(new THREE.Vector3(3000, 100, 3000), 600, 0);
  expect(covered(mesh, job.sections[0].id)).toBe(false);
  view.update(camera, 600, 0);
  expect(covered(mesh, job.sections[0].id)).toBe(true);
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  worker.onerror?.({ message: "test failure" });
  expect(view.workerActive).toBe(false);
  expect(covered(mesh, job.sections[0].id)).toBe(false);
  view.update(camera, 600, 0);
  expect(
    view.chunks.some(
      (c) => c.mesh.geometry.getAttribute("position")?.count > 0,
    ),
  ).toBe(true);
  log.mockRestore();
  view.dispose();
});

it("keeps a backdrop without workers and refreshes distant damage and restored saves", () => {
  vi.stubGlobal("Worker", undefined);
  const view = create(),
    mesh = coarse(view);
  expect(mesh).toBeDefined();
  const p = mesh.geometry.getAttribute("position");
  expect(p.getY(0)).toBe(79);
  const id = 10 * CHUNKS + 10,
    x = 640,
    z = 640,
    index = (z / 2) * CONFIG.grid + x / 2;
  const vertex = 10 * (CHUNKS + 1) + 10;
  view.patch({
    indices: new Uint32Array([index]),
    values: new Float32Array([20]),
    chunks: [id],
  });
  expect(p.getY(vertex)).toBe(79); // Packet handling only queues optional backdrop work.
  view.update(new THREE.Vector3(4000, 100, 4000), 600, 0);
  expect(p.getY(vertex)).toBe(79);
  for (let i = 0; i < 20 && p.getY(vertex) !== 19; i++)
    view.update(new THREE.Vector3(4000, 100, 4000), 600, 100);
  expect(p.getY(vertex)).toBe(19);
  const normal = mesh.geometry.getAttribute("normal");
  expect(Number.isFinite(normal.getY(vertex))).toBe(true);
  view.update(new THREE.Vector3(640, 100, 640), 600, 0);
  expect(Array.from(mesh.geometry.index!.array).some((n) => n === 0)).toBe(
    true,
  );
  view.update(new THREE.Vector3(4000, 100, 4000), 600, 0);
  expect(covered(mesh, id)).toBe(false);
  view.restore(new Float32Array(CONFIG.grid * CONFIG.grid).fill(120));
  expect(p.getY(vertex)).toBe(119);
  view.dispose();
});
