import { afterEach, expect, it, vi } from "vitest";
import * as THREE from "three";
import { CONFIG, CHUNKS } from "../src/config";
import { TerrainView } from "../src/render/terrain-view";
import { terrainRoadWeights } from "../src/render/terrain-colors";
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
