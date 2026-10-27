import { expect, it } from "vitest";
import * as THREE from "three";
import { PortalView } from "../src/render/portal";
import { ResourceDisposal } from "../src/render/resource-disposal";
import type { WorldData } from "../src/types";
it.each(["surface", "hell"] as const)(
  "animates and extinguishes the %s toilet water",
  (realm) => {
    const view = new PortalView({
      realm,
      portal: { x: 20, y: 30, z: 40, radius: 54, ids: [], yaw: 0.5, water: [50, 60] },
    } as unknown as WorldData);
    expect(view.group.position.toArray()).toEqual([20, 30, 40]);
    expect(view.group.rotation.y).toBe(0.5);
    const disc = view.group.children[0] as THREE.Mesh<
      THREE.CircleGeometry,
      THREE.ShaderMaterial
    >;
    // The disc tucks just past the bowl's inner wall.
    expect(disc.scale.x).toBeCloseTo(53);
    expect(disc.scale.z).toBeCloseTo(63.6);
    view.update(3, true);
    expect(disc.visible).toBe(true);
    expect(disc.material.uniforms.time.value).toBe(3);
    view.update(3, false);
    expect(disc.visible).toBe(false);
    const resources = new ResourceDisposal();
    resources.collect(view.group);
    expect(resources.geometries.size).toBe(1);
    resources.dispose();
  },
);
