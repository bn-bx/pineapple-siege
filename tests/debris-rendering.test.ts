import { expect, it } from "vitest";
import * as THREE from "three";
import { GameRenderer } from "../src/render/renderer";
import type { BodyView } from "../src/types";

function fixture() {
  // Exercise instance packing without requiring a browser/WebGL context.
  const view = Object.create(GameRenderer.prototype) as any;
  const geometry = new THREE.BoxGeometry(2, 2, 2);
  const material = new THREE.MeshBasicMaterial();
  view.scene = new THREE.Scene();
  view.bodyMeshes = new Map([
    ["stone", new THREE.InstancedMesh(geometry, material, 8192)],
  ]);
  view.fallenPines = new THREE.InstancedMesh(geometry, material, 8192);
  view.fallenTrunks = new THREE.InstancedMesh(geometry, material, 8192);
  view.previousBodies = new Map();
  view.debrisRotation = new THREE.Quaternion();
  view.fragmentColor = new THREE.Color();
  view.world = { entities: [{ s: [4, 8, 4] }] };
  return {
    view,
    dispose() {
      for (const mesh of [
        ...view.bodyMeshes.values(),
        view.fallenPines,
        view.fallenTrunks,
      ])
        mesh.dispose();
      geometry.dispose();
      material.dispose();
    },
  };
}
const body = (id: number): BodyView => ({
  id,
  source: 0,
  kind: "chunk",
  material: "stone",
  p: [id, 100, 600],
  s: [1, 1, 1],
  q: [0, 0, 0, 1],
});

it("renders overflow stone and trees beyond the rigid-body cap without dropping instances", () => {
  const { view, dispose } = fixture();
  try {
    const bodies = Array.from({ length: 8300 }, (_, i) => body(i));
    bodies.push(
      ...Array.from(
        { length: 8300 },
        (_, i): BodyView => ({ ...body(i + 8300), kind: "tree" }),
      ),
    );
    view.syncBodies(bodies, 1);
    expect(view.bodyMeshes.get("stone").count).toBe(8300);
    expect(view.fallenPines.count).toBe(8300);
    expect(view.fallenTrunks.count).toBe(8300);
    const matrix = new THREE.Matrix4();
    view.bodyMeshes.get("stone").getMatrixAt(8299, matrix);
    expect(matrix.elements[12]).toBe(8299);
    view.fallenTrunks.getMatrixAt(8299, matrix);
    expect(matrix.elements[12]).toBe(16599);
  } finally {
    dispose();
  }
});

it("interpolates debris on successive frames and leaves paused transforms unchanged", () => {
  const { view, dispose } = fixture();
  try {
    const old = body(42),
      current = {
        ...body(42),
        p: [52, 120, 600] as [number, number, number],
        q: [0, 1, 0, 0] as [number, number, number, number],
      };
    view.previousBodies.set(42, old);
    const bodies = [current],
      matrix = new THREE.Matrix4();
    view.syncBodies(bodies, 0.5);
    view.bodyMeshes.get("stone").getMatrixAt(0, matrix);
    expect(matrix.elements[12]).toBe(47);
    expect(matrix.elements[13]).toBe(110);
    expect(matrix.elements[0]).toBeCloseTo(0);
    expect(Math.abs(matrix.elements[2])).toBeCloseTo(1);
    view.syncBodies(bodies, 1);
    view.bodyMeshes.get("stone").getMatrixAt(0, matrix);
    expect(matrix.elements[12]).toBe(52);
    expect(matrix.elements[0]).toBeCloseTo(-1);
    const version = view.bodyMeshes.get("stone").instanceMatrix.version;
    view.syncBodies(bodies, 1);
    expect(view.bodyMeshes.get("stone").instanceMatrix.version).toBe(version);
  } finally {
    dispose();
  }
});
