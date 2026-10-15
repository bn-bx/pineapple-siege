import * as THREE from "three";
import type { WorldData } from "../types";
import { bakeMaterialGroups, makeInfernalJet } from "./infernal-jet";

/** A segmented aircraft effigy occupying the existing god's destructible volume. */
export class JetGodView {
  readonly group = new THREE.Group();
  private parts: { mesh: THREE.Mesh; owners: number[] }[] = [];
  constructor(world: WorldData) {
    const site = world.sites.find((s) => s.kind === "pineapple-god");
    if (!site) return;
    const figure = world.entities.filter((e) => e.visual && (e.visual.role === "figure" || e.visual.role === "eye"));
    const ids = (part: number) => figure.filter((e, i) => i % 6 === part).map((e) => e.id);
    const effigy = makeInfernalJet("god");
    const sections = new Map<number, THREE.Group>();
    for (const object of [...effigy.children]) {
      const section = object.userData.section ?? 0;
      let root = sections.get(section);
      if (!root) sections.set(section, root = new THREE.Group());
      root.add(object);
    }
    for (const [section, root] of sections)
      for (const { geometry, material } of bakeMaterialGroups(root)) {
        const mesh = new THREE.Mesh(geometry, material);
        mesh.castShadow = mesh.receiveShadow = true;
        effigy.add(mesh);
        this.parts.push({ mesh, owners: ids(section) });
      }
    effigy.scale.setScalar(26);
    this.group.add(effigy);
    this.group.position.set(...site.p);
    this.group.position.y += 550;
    this.group.rotation.y = site.yaw ?? 0;
  }
  update(removed: ReadonlySet<number>) {
    for (const { mesh, owners } of this.parts)
      mesh.visible = owners.length === 0 || owners.filter((id) => removed.has(id)).length < owners.length * 0.35;
  }
}
