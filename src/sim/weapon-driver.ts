import type { Flies } from "./flies";
import { CONFIG, RAPID_FIRE_INTERVAL, WEAPONS } from "../config";
import { nukeProfile } from "../destruction-settings";
import type {
  BlastProfile,
  DestructionJob,
  Explosion,
  InputState,
  NukeYield,
  PlaneState,
  ProjectileWeapon,
  Vec3,
  WeaponId,
} from "../types";
import { Monsters } from "./monsters";
import type { UpgradeId } from "../economy/pricing";
const distance = (a: Vec3, b: Vec3) =>
  Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
interface Shot {
  profile?: BlastProfile;
  weapon: ProjectileWeapon;
  yield: NukeYield;
  id: number;
  p: Vec3;
  v: Vec3;
  age: number;
}

export interface WeaponDriverContext {
  weapon: WeaponId;
  input: InputState;
  cooldowns: Record<WeaponId, number>;
  dropGravityBomb: (plane: PlaneState) => boolean;
  /** Pineapple bucks: whether a shot is affordable, and paying for it. */
  canAfford?: (weapon: WeaponId) => boolean;
  charge?: (weapon: WeaponId) => void;
  /** An owned upgrade's stat multiplier (1 when unowned). */
  upgrade?: (id: UpgradeId) => number;
  /** Truck only: muzzle and world velocity solved onto the crosshair. */
  groundLaunch?: (weapon: WeaponId) => { p: Vec3; v: Vec3 };
  laserAim: () => Vec3 | null;
  startLaser: (p: Vec3) => void;
  destruction: {
    bodies: number;
    fragments: number;
    cosmetics: number;
    rubble: number;
    noCooldown: boolean;
    nukeScale: number;
    laserSize: number;
    laserDepth: number;
    laserBrightness: number;
  };
  projectiles: Shot[];
  pendingJobs: DestructionJob[];
  shots: number;
  nextShot: number;
  nukeYield: NukeYield;
  sweep: (
    a: Vec3,
    b: Vec3,
    radius?: number,
    halfLength?: number,
  ) => Vec3 | null;
  flies?: Flies;
  monsters: Monsters;
  detonateNuke: (
    p: Vec3,
    strength?: NukeYield,
    releasedProfile?: BlastProfile,
  ) => void;
  explode: (p: Vec3, power?: number, kind?: Explosion["kind"]) => void;
}
export class WeaponDriver {
  constructor(private host: WeaponDriverContext) {}
  fire(p: PlaneState, f: Vec3): void {
    if (p.crashed > 0) return;
    const weapon = this.host.weapon;
    // Unaffordable shots never fire and never consume a cooldown.
    if (this.host.canAfford && !this.host.canAfford(weapon)) return;
    if (weapon === "gravityBomb") {
      if (
        this.host.input.fire &&
        this.host.cooldowns.gravityBomb <= 1e-9 &&
        this.host.dropGravityBomb(this.bombRelease(p))
      ) {
        this.host.charge?.(weapon);
        this.host.cooldowns.gravityBomb = this.host.destruction.noCooldown
          ? RAPID_FIRE_INTERVAL
          : WEAPONS.gravityBomb.cooldown;
        this.host.shots++;
      }
      return;
    }
    if (weapon === "laser") {
      if (this.host.input.fire && this.host.cooldowns.laser <= 1e-9) {
        const target = this.host.laserAim();
        if (target) {
          this.host.startLaser(target);
          this.host.charge?.(weapon);
        }
      }
      return;
    }
    const tuning = WEAPONS[weapon];
    if (
      this.host.input.fire &&
      this.host.cooldowns[weapon] <= 1e-9 &&
      (this.host.destruction.noCooldown ||
        (this.host.projectiles.length < CONFIG.maxProjectiles &&
          (weapon !== "nuke" ||
            this.host.pendingJobs.length +
              this.host.projectiles.filter((p) => p.weapon === "nuke").length <
              8)))
    ) {
      this.host.cooldowns[weapon] = this.host.destruction.noCooldown
        ? RAPID_FIRE_INTERVAL
        : weapon === "cannon"
          ? tuning.cooldown * Math.max(0.2, 2 - this.bonus("cannonRate"))
          : tuning.cooldown;
      this.host.shots++;
      this.host.charge?.(weapon);
      // Driving: the solved launch lands the shot on the crosshair.
      const solved =
        p.mode === "ground" ? this.host.groundLaunch?.(weapon) : undefined;
      this.host.projectiles.push({
        id: this.host.nextShot++,
        weapon,
        yield: this.host.nukeYield,
        profile:
          weapon === "nuke" ? this.nukeProfile() : undefined,
        p: solved
          ? solved.p
          : weapon === "cannon"
            ? (p.p.map((v, i) => v + f[i] * 12) as Vec3)
            : [p.p[0], p.p[1] - 12, p.p[2]],
        v: solved
          ? solved.v
          : weapon === "cannon"
            ? (f.map((v) => v * (p.speed + tuning.launchSpeed)) as Vec3)
            : [p.v[0], p.v[1] - 8, p.v[2]],
        age: 0,
      });
    }
  }
  private bonus(id: UpgradeId) {
    return this.host.upgrade?.(id) ?? 1;
  }
  private nukeProfile(): BlastProfile {
    const profile = nukeProfile(this.host.nukeYield, this.host.destruction),
      scale = this.bonus("nukeYield");
    if (scale === 1) return profile;
    return {
      ...profile,
      damageRadius: profile.damageRadius * scale,
      craterRadius: profile.craterRadius * scale,
    };
  }
  /** Gravity bombs drop from the aircraft, or are lobbed by the truck. */
  private bombRelease(p: PlaneState): PlaneState {
    const solved =
      p.mode === "ground" ? this.host.groundLaunch?.("gravityBomb") : undefined;
    if (!solved) return p;
    // Bombs release 12 m below the point they are given.
    return {
      ...p,
      p: [solved.p[0], solved.p[1] + 12, solved.p[2]],
      v: solved.v,
    };
  }
  update(dt: number): void {
    for (let i = this.host.projectiles.length - 1; i >= 0; i--) {
      const s = this.host.projectiles[i];
      let next = s.p.map((v, k) => v + s.v[k] * dt) as Vec3,
        hit = this.host.sweep(
          s.p,
          next,
          WEAPONS[s.weapon].radius,
          WEAPONS[s.weapon].length / 2,
        );
      const flyHit = this.host.flies?.intersect(
        s.p,
        next,
        WEAPONS[s.weapon].radius,
      );
      if (flyHit && (!hit || distance(s.p, flyHit.p) < distance(s.p, hit)))
        hit = flyHit.p;
      const monsterHit = this.host.monsters.intersect(
        s.p,
        next,
        WEAPONS[s.weapon].radius,
      );
      if (
        monsterHit &&
        (!hit || distance(s.p, monsterHit.p) < distance(s.p, hit))
      )
        hit = monsterHit.p;
      s.age += dt;
      if (hit) {
        this.host.projectiles.splice(i, 1);
        if (s.weapon === "nuke")
          this.host.detonateNuke(hit, s.yield, s.profile);
        else {
          const power = this.bonus("cannonBlast");
          if (power === 1) this.host.explode(hit);
          else this.host.explode(hit, power);
        }
      } else if (
        s.age > WEAPONS[s.weapon].lifetime ||
        next[0] < 0 ||
        next[0] > CONFIG.worldSize ||
        next[2] < 0 ||
        next[2] > CONFIG.worldSize
      )
        this.host.projectiles.splice(i, 1);
      else {
        s.p = next;
        s.v[1] -= WEAPONS[s.weapon].gravity * dt;
      }
    }
  }
}
