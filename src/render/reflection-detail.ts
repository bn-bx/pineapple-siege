import * as THREE from "three";

interface ForestBatch {
  kind: string;
  mesh: THREE.InstancedMesh;
  middle?: THREE.InstancedMesh;
  low?: THREE.InstancedMesh;
}

/** A low-resolution reflection shares owners and transforms with the main view. */
export function withReflectionDetail<T>(
  scene: THREE.Scene,
  batches: readonly ForestBatch[],
  ranges: THREE.Vector2,
  decorations: THREE.Group | undefined,
  render: () => T,
): T {
  const near = ranges.x,
    middle = ranges.y;
  const visible = new Map<THREE.Object3D, boolean>();
  const added: THREE.Object3D[] = [];
  const set = (object: THREE.Object3D | undefined, value: boolean) => {
    if (!object) return;
    visible.set(object, object.visible);
    object.visible = value;
  };
  try {
    ranges.set(0, 0);
    set(decorations, false);
    for (const batch of batches) {
      if (batch.kind === "trunk") {
        set(batch.mesh, false);
        continue;
      }
      if (batch.kind !== "pine" || !batch.low || !batch.middle) continue;
      // Distant, detached batches are already covered by IslandHorizon. Do
      // not reactivate the entire island just to simplify nearby foliage.
      if (
        ![batch.mesh, batch.middle, batch.low].some(
          (mesh) => mesh.visible && mesh.count > 0 && mesh.parent,
        )
      )
        continue;
      set(batch.mesh, false);
      set(batch.middle, false);
      set(batch.low, batch.low.count > 0);
      if (batch.low.count && !batch.low.parent) {
        scene.add(batch.low);
        added.push(batch.low);
      }
    }
    return render();
  } finally {
    ranges.set(near, middle);
    for (const object of added) scene.remove(object);
    for (const [object, value] of visible) object.visible = value;
  }
}
