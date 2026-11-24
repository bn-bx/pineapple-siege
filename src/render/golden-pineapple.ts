import * as THREE from "three";
import { makePineapple } from "./assets";
import type { Vec3 } from "../types";
import { christmas } from "../christmas";
import { festiveMaterials, present } from "./christmas/costumes";

const SIZE = 14;

/**
 * Collectible golden pineapples: a spinning gold fruit. Collected ones are
 * hidden.
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

  constructor() {
    this.group.name = "golden-pineapples";
  }

  set(points: Vec3[], collected: number[]) {
    if (points.length !== this.items.length) {
      this.clear();
      for (let i = 0; i < points.length; i++) {
        const item = new THREE.Group();
        const fruit = christmas() ? this.gift(i) : makePineapple(SIZE);
        fruit.traverse((o) => {
          if (o instanceof THREE.Mesh) {
            if (!christmas()) o.material = this.gold;
            o.castShadow = false;
          }
        });
        item.add(fruit);
        this.items.push(item);
        this.group.add(item);
      }
    }
    points.forEach((p, i) => this.items[i].position.set(p[0], p[1], p[2]));
    const taken = new Set(collected);
    this.items.forEach((item, i) => (item.visible = !taken.has(i)));
  }

  /** Christmas: a wrapped present with a gold ribbon, centred like the fruit. */
  private gift(i: number) {
    const f = festiveMaterials();
    const paper = [f.red, f.green, f.deepRed][i % 3];
    const box = present(9, 8, 9, paper, this.gold);
    box.position.y = -4;
    const holder = new THREE.Group();
    holder.add(box);
    return holder;
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
