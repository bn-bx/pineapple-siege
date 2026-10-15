import { expect, it } from "vitest";
import { JetMonsterView } from "../src/render/jet-monsters";
import type { SimulationSnapshot } from "../src/types";
import * as THREE from "three";
import { ResourceDisposal } from "../src/render/resource-disposal";
import { JetGodView } from "../src/render/jet-god";
import type { WorldData } from "../src/types";

it("draws active hell jets and omits defeated ones", () => {
  const view = new JetMonsterView();
  const snapshot = {
    monsters: [
      { id: 0, p: [100, 200, 300], yaw: 0.4, stagger: 0, defeated: false, cleared: false },
      { id: 1, p: [110, 200, 310], yaw: 0, stagger: 0, defeated: true, cleared: false },
    ],
  } as SimulationSnapshot;
  view.update(snapshot, undefined, 1);
  expect(view.mesh.count).toBe(1);
  expect(view.mesh.visible).toBe(true);
  expect(view.group.children.length).toBeLessThanOrEqual(6);
  for (const mesh of view.group.children as THREE.InstancedMesh[])
    expect(mesh.count).toBe(1);
  const resources = new ResourceDisposal();
  resources.collect(view.group);
  resources.dispose();
});

it("keeps the detailed god attached to its destructible sections", () => {
  const world = {
    sites: [{ kind: "pineapple-god", p: [0, 0, 0] }],
    entities: Array.from({ length: 6 }, (_, id) => ({ id, visual: { role: "figure" } })),
  } as WorldData;
  const view = new JetGodView(world);
  const parts: THREE.Mesh[] = [];
  view.group.traverse((object) => { if (object instanceof THREE.Mesh) parts.push(object); });
  expect(parts.length).toBeLessThanOrEqual(36);
  view.update(new Set([0]));
  expect(parts.some((part) => !part.visible)).toBe(true);
  expect(parts.some((part) => part.visible)).toBe(true);
  view.update(new Set([0, 1, 2, 3, 4, 5]));
  expect(parts.every((part) => !part.visible)).toBe(true);
  const resources = new ResourceDisposal();
  resources.collect(view.group);
  resources.dispose();
});
