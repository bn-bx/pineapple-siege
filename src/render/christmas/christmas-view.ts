import * as THREE from "three";
import type { Explosion, FragmentEffect, WorldData } from "../../types";
import { christmasMode, XMAS } from "../../christmas";
import { ChristmasLights } from "./christmas-lights";
import { ChristmasWorld } from "./christmas-world";
import { FestiveParticles } from "./festive-particles";
import { Snowfall } from "./snowfall";
import { FestiveJet } from "./vehicles";

interface Ground {
  sample(x: number, z: number): number;
  waterSurface(x: number, z: number): number | undefined;
}

export interface ChristmasFrame {
  dt: number;
  elapsed: number;
  time: number;
  camera: THREE.Camera;
  night: number;
  daylight: number;
  /** Space-laser light-show strength, 0–1. */
  show: number;
  removed: ReadonlySet<number>;
  viewportHeight: number;
  reduced: boolean;
  /** The player's vehicle, when it is close to the ground. */
  vehicle?: THREE.Vector3;
  speed: number;
}

/**
 * Everything the Christmas look adds to the renderer, behind one object so
 * the renderer only forwards frames and events to it.
 */
export class ChristmasView {
  readonly group = new THREE.Group();
  readonly particles = new FestiveParticles();
  private lights?: ChristmasLights;
  private snowfall?: Snowfall;
  private world: ChristmasWorld;
  /** The jet's dress; Hell's pineapple aircraft only takes the sleigh swap. */
  private jet?: FestiveJet;
  private hell: boolean;
  constructor(world: WorldData, ground: Ground, jet: THREE.Object3D) {
    this.group.name = "christmas";
    this.hell = world.realm === "hell";
    if (!this.hell) {
      this.lights = new ChristmasLights(world.entities);
      this.snowfall = new Snowfall();
      this.group.add(this.lights.points, this.snowfall.points);
    }
    this.world = new ChristmasWorld(world, ground, this.particles);
    const sleighMode = christmasMode() === "sleigh";
    if (!this.hell || sleighMode) this.jet = new FestiveJet(jet, sleighMode);
    this.group.add(this.world.group, this.particles.points);
  }

  update(frame: ChristmasFrame) {
    this.lights?.update(frame.night, frame.show, frame.time, frame.removed, frame.viewportHeight);
    this.snowfall?.update(frame.camera, frame.elapsed, frame.daylight, frame.viewportHeight, frame.reduced);
    this.world.update(frame.dt, frame.elapsed, frame.vehicle, frame.removed);
    this.jet?.update(frame.elapsed, frame.night, frame.speed);
    this.particles.update(frame.dt, frame.elapsed, frame.viewportHeight);
  }

  explosion(e: Explosion) {
    this.world.explosion(e);
  }

  /** Falling and shattered trees shake their snow off. */
  fragment(e: FragmentEffect) {
    if (this.hell || e.material !== "foliage") return;
    this.particles.puff(e.p[0], e.p[1], e.p[2], 4 + e.spread * 0.5, 18);
  }

  /** Gold, silver and red tinsel streaming from the rocket launch. */
  tinsel(at: THREE.Vector3, back: THREE.Vector3) {
    for (let i = 0; i < 4; i++)
      this.particles.emit(
        at.x, at.y, at.z,
        back.x * 8 + (Math.random() - 0.5) * 6,
        back.y * 8 + (Math.random() - 0.5) * 6,
        back.z * 8 + (Math.random() - 0.5) * 6,
        [XMAS.gold, "#e8eef5", XMAS.red, XMAS.green][(Math.random() * 4) | 0],
        0.35 + Math.random() * 0.3,
        2.2,
        3,
        0.8,
      );
  }

  /** Snow kicked up behind the truck's wheels. */
  snowSpray(at: THREE.Vector3, velocity: THREE.Vector3) {
    for (let i = 0; i < 3; i++)
      this.particles.emit(
        at.x + (Math.random() - 0.5) * 2,
        at.y,
        at.z + (Math.random() - 0.5) * 2,
        -velocity.x * 0.15 + (Math.random() - 0.5) * 4,
        3 + Math.random() * 4,
        -velocity.z * 0.15 + (Math.random() - 0.5) * 4,
        "#f4f8ff",
        0.6 + Math.random() * 0.5,
        0.9,
        9,
        1,
      );
  }

  /** A villager's snowball, lobbed forward. */
  snowball(x: number, y: number, z: number, yaw: number) {
    const a = yaw + (Math.random() - 0.5) * 0.8;
    this.particles.emit(x, y, z, Math.sin(a) * 9, 7 + Math.random() * 3, Math.cos(a) * 9, "#ffffff", 0.35, 1.4, 9.8, 0.05);
  }

  reset() {
    this.particles.reset();
    this.lights?.invalidate();
    this.world.invalidate();
  }

  dispose() {
    this.lights?.dispose();
    this.snowfall?.dispose();
    this.particles.dispose();
    this.world.dispose();
    this.group.removeFromParent();
  }
}
