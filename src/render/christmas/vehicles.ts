import * as THREE from "three";
import { festiveMaterials, glowTexture, reindeer, santaHat, sleigh } from "./costumes";

/**
 * Festive dress for the player's jet: candy-cane bands, a glowing Rudolph
 * nose and a Santa hat on the canopy, or (sleigh mode) Santa's sleigh and a
 * reindeer team in place of the airframe, with the engine flames kept as
 * rocket boosters.
 */
export class FestiveJet {
  readonly decor = new THREE.Group();
  private legs: THREE.Object3D[] = [];
  private noseGlow: THREE.Sprite;
  constructor(jet: THREE.Object3D, sleighMode: boolean) {
    const f = festiveMaterials();
    this.decor.name = "christmas-jet";
    this.noseGlow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTexture(),
        color: "#ff2a1a",
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: false,
      }),
    );
    if (sleighMode) {
      // Hide the airframe, keep the flames.
      const hide = (m: THREE.Material) => {
        const hidden = m.clone();
        hidden.visible = false;
        return hidden;
      };
      jet.traverse((o) => {
        if (o instanceof THREE.Line || o instanceof THREE.Points) {
          o.visible = false;
          return;
        }
        if (!(o instanceof THREE.Mesh) || o.name.startsWith("flame")) return;
        o.material = Array.isArray(o.material)
          ? o.material.map(hide)
          : hide(o.material);
        o.castShadow = false;
      });
      const ride = sleigh();
      ride.scale.setScalar(1.25);
      ride.position.set(0, -1.6, -1.5);
      const santa = new THREE.Group();
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.75, 12, 10), f.red);
      body.scale.set(1, 1.1, 0.9);
      body.position.y = 1.9;
      const belt = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.08, 6, 20), f.coal);
      belt.rotation.x = Math.PI / 2;
      belt.position.y = 1.75;
      const head = new THREE.Mesh(
        new THREE.SphereGeometry(0.36, 10, 8),
        new THREE.MeshStandardMaterial({ color: "#f0c09a", roughness: 0.9 }),
      );
      head.position.set(0, 2.85, 0.05);
      const beard = new THREE.Mesh(new THREE.SphereGeometry(0.34, 10, 8), f.fur);
      beard.scale.set(1, 1.1, 0.7);
      beard.position.set(0, 2.62, 0.22);
      const hat = santaHat(0.36, 0.8);
      hat.position.set(0, 3.08, 0);
      hat.rotation.x = 0.4;
      santa.add(body, belt, head, beard, hat);
      santa.position.set(0, 0, 0.2);
      ride.add(santa);
      this.decor.add(ride);
      const team: [number, number, boolean][] = [
        [-1.2, 5.2, false],
        [1.2, 5.2, false],
        [-1.2, 8.6, false],
        [1.2, 8.6, false],
        [0, 12, true],
      ];
      const harness: number[] = [];
      for (const [x, z, rudolph] of team) {
        const deer = reindeer(rudolph);
        deer.position.set(x, -1.6, z);
        this.legs.push(...(deer.userData.legs as THREE.Object3D[]));
        this.decor.add(deer);
        harness.push(0, -0.3, 1.4, x, 0, z + 0.2);
      }
      const reins = new THREE.LineSegments(
        new THREE.BufferGeometry().setAttribute(
          "position",
          new THREE.Float32BufferAttribute(harness, 3),
        ),
        new THREE.LineBasicMaterial({ color: "#d4af37" }),
      );
      this.decor.add(reins);
      this.noseGlow.position.set(0, 0.8, 13.75);
      this.noseGlow.scale.setScalar(2.2);
    } else {
      // Candy-cane bands round the tail half of the fuselage.
      for (const z of [-3.5, -2.5, -1.5, -0.5]) {
        const radius = 1.05 - (z / 8) * 0.4 + 0.03;
        const band = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.13, 6, 28), f.red);
        band.position.z = z;
        this.decor.add(band);
      }
      const nose = new THREE.Mesh(new THREE.SphereGeometry(0.42, 14, 10), f.redNose);
      nose.position.z = 7.9;
      this.decor.add(nose);
      this.noseGlow.position.set(0, 0, 8.3);
      this.noseGlow.scale.setScalar(3);
      const hat = santaHat(0.62, 1.4);
      hat.position.set(0, 1.25, 1.6);
      hat.rotation.x = -0.5;
      this.decor.add(hat);
    }
    this.decor.add(this.noseGlow);
    jet.add(this.decor);
  }

  /** Gallop the team and pulse the nose; `night` brightens the glow. */
  update(elapsed: number, night: number, speed: number) {
    const gallop = elapsed * (6 + Math.min(speed, 200) * 0.02);
    this.legs.forEach((leg, i) => {
      leg.rotation.x = Math.sin(gallop + (i % 4) * 1.6) * 0.6;
    });
    const pulse = 0.75 + 0.25 * Math.sin(elapsed * 4);
    this.noseGlow.material.opacity = (0.25 + night * 0.75) * pulse;
  }
}
