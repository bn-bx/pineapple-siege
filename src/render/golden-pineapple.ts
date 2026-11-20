import * as THREE from "three";
import { makePineapple } from "./assets";
import type { Vec3 } from "../types";

const SIZE = 14;
const BEAM_HEIGHT = 320;

/**
 * Collectible golden pineapples: a spinning gold fruit with a soft light beam
 * so they can be spotted from a distance. Collected ones are hidden.
 */
export class GoldenPineapples {
  readonly group = new THREE.Group();
  private items: THREE.Group[] = [];
  private gold = new THREE.MeshStandardMaterial({
    color: "#ffc93a",
    emissive: "#b8860b",
    emissiveIntensity: 0.7,
    metalness: 0.85,
    roughness: 0.25,
  });
  private beamMaterial = new THREE.MeshBasicMaterial({
    color: "#ffd95a",
    transparent: true,
    opacity: 0.16,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
  });
  private beam = new THREE.CylinderGeometry(2.5, 6, BEAM_HEIGHT, 10, 1, true);

  constructor() {
    this.group.name = "golden-pineapples";
  }

  set(points: Vec3[], collected: number[]) {
    if (points.length !== this.items.length) {
      this.clear();
      for (let i = 0; i < points.length; i++) {
        const item = new THREE.Group();
        const fruit = makePineapple(SIZE);
        fruit.traverse((o) => {
          if (o instanceof THREE.Mesh) {
            o.material = this.gold;
            o.castShadow = false;
          }
        });
        const beam = new THREE.Mesh(this.beam, this.beamMaterial);
        beam.position.y = BEAM_HEIGHT / 2;
        beam.renderOrder = 2;
        item.add(fruit, beam);
        this.items.push(item);
        this.group.add(item);
      }
    }
    points.forEach((p, i) => this.items[i].position.set(p[0], p[1], p[2]));
    const taken = new Set(collected);
    this.items.forEach((item, i) => (item.visible = !taken.has(i)));
  }

  update(elapsed: number) {
    for (let i = 0; i < this.items.length; i++) {
      const item = this.items[i];
      if (!item.visible) continue;
      const fruit = item.children[0];
      fruit.rotation.y = elapsed * 1.6 + i;
      fruit.position.y = Math.sin(elapsed * 2 + i) * 1.5;
    }
  }

  clear() {
    this.group.clear();
    this.items = [];
  }
}
