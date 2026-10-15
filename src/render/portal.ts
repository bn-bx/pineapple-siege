import * as THREE from "three";
import type { WorldData } from "../types";

/** The opening is an overlay; the simulation owns the actual crossing. */
export class PortalView {
  readonly group = new THREE.Group();
  private disc: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
  private rim: THREE.Mesh<THREE.TorusGeometry, THREE.MeshStandardMaterial>;
  constructor(world: WorldData) {
    const portal = world.portal!;
    const hell = world.realm === "hell";
    const color = hell ? "#ff531c" : "#2789ff";
    this.disc = new THREE.Mesh(
      new THREE.CircleGeometry(portal.radius - 4, 64).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.72, side: THREE.DoubleSide, depthWrite: false }),
    );
    this.disc.position.y = 1.4;
    this.rim = new THREE.Mesh(
      new THREE.TorusGeometry(portal.radius + 1, 3.5, 12, 72).rotateX(Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: hell ? "#351b14" : "#263e68", emissive: color, emissiveIntensity: 1.5, metalness: 0.65, roughness: 0.3 }),
    );
    this.rim.position.y = 3;
    this.group.position.set(portal.x, portal.y, portal.z);
    this.group.add(this.disc, this.rim);
  }
  update(time: number, intact: boolean) {
    this.disc.visible = intact;
    this.disc.material.opacity = 0.58 + 0.15 * Math.sin(time * 3);
    this.disc.rotation.y = time * 0.2;
    this.rim.material.emissiveIntensity = intact ? 1.2 + 0.4 * Math.sin(time * 4) : 0;
  }
}
