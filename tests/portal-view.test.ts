import { expect, it } from "vitest";
import * as THREE from "three";
import { PortalView } from "../src/render/portal";
import { ResourceDisposal } from "../src/render/resource-disposal";
import type { WorldData } from "../src/types";
it.each(["surface", "hell"] as const)(
  "animates and extinguishes the %s portal without hiding its physical rim",
  (realm) => {
    const view = new PortalView({
      realm,
      portal: { x: 20, y: 30, z: 40, radius: 54, ids: [] },
    } as unknown as WorldData);
    expect(view.group.position.toArray()).toEqual([20, 30, 40]);
    view.update(3, true);
    const rim = view.group.children[0] as THREE.Mesh<
      THREE.TorusGeometry,
      THREE.MeshStandardMaterial
    >;
    const energy = view.group.children[1];
    expect(rim.geometry.parameters.radius).toBe(54);
    expect(energy.visible).toBe(true);
    view.update(3, false);
    expect(energy.visible).toBe(false);
    expect(rim.visible).toBe(true);
    expect(rim.material.emissiveIntensity).toBe(0);
    const resources = new ResourceDisposal();
    resources.collect(view.group);
    expect(resources.geometries.size).toBe(3);
    resources.dispose();
  },
);
