import RAPIER from "@dimforge/rapier3d-compat";
import { CONFIG, STEEL_BALL } from "../config";
import type { PlaneState, SteelBallState, Vec3 } from "../types";
import type { Terrain } from "./terrain";

/** Exact squared distance between a segment and an axis-aligned box. */
export function sweptSphereTouches(
  a: Vec3,
  b: Vec3,
  p: Vec3,
  s: Vec3,
  radius: number,
) {
  const d = b.map((v, i) => v - a[i]);
  const cuts = [0, 1];
  for (let i = 0; i < 3; i++) {
    if (!d[i]) continue;
    for (const edge of [p[i] - s[i], p[i] + s[i]]) {
      const t = (edge - a[i]) / d[i];
      if (t > 0 && t < 1) cuts.push(t);
    }
  }
  cuts.sort((x, y) => x - y);
  const distance = (t: number) =>
    a.reduce(
      (sum, v, i) =>
        sum + Math.max(0, Math.abs(v + d[i] * t - p[i]) - s[i]) ** 2,
      0,
    );
  for (let j = 1; j < cuts.length; j++) {
    const lo = cuts[j - 1],
      hi = cuts[j],
      mid = (lo + hi) / 2;
    let dd = 0,
      ad = 0;
    for (let i = 0; i < 3; i++) {
      const x = a[i] + d[i] * mid;
      if (x >= p[i] - s[i] && x <= p[i] + s[i]) continue;
      const offset = a[i] - (x < p[i] ? p[i] - s[i] : p[i] + s[i]);
      dd += d[i] ** 2;
      ad += offset * d[i];
    }
    const t = dd ? Math.max(lo, Math.min(hi, -ad / dd)) : mid;
    if (distance(t) <= radius ** 2) return true;
  }
  return false;
}

interface Ball {
  id: number;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  previous: Vec3;
  age: number;
  rest: number;
  airborne: number;
  crushLoss: number;
  fade: number;
  grounded: boolean;
  lastTerrain: Vec3 | null;
  terrainTime: number;
  dented: boolean;
  soundAge: number;
  impactSpeed: number;
}
export class SteelBalls {
  readonly balls: Ball[] = [];
  private nextId = 1;
  constructor(
    private physics: RAPIER.World,
    private terrain: Terrain,
    private crush: (a: Vec3, b: Vec3, speed: number) => number,
    private impact: (p: Vec3, energy: number, rolling: boolean) => void,
    private terrainDamage: (
      a: Vec3,
      b: Vec3,
      landing: boolean,
    ) => void = () => {},
  ) {}
  drop(plane: PlaneState): boolean {
    while (this.balls.length >= STEEL_BALL.maxActive) {
      const oldest = this.balls.shift()!;
      this.physics.removeRigidBody(oldest.body);
    }
    const p: Vec3 = [
      plane.p[0],
      plane.p[1] - STEEL_BALL.radius - 6,
      plane.p[2],
    ];
    const body = this.physics.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(...p)
        .setLinvel(...plane.v)
        .setCcdEnabled(true)
        .setSoftCcdPrediction(2)
        .setAngularDamping(STEEL_BALL.angularDamping),
    );
    const collider = this.physics.createCollider(
      RAPIER.ColliderDesc.ball(STEEL_BALL.radius)
        .setDensity(7800)
        .setFriction(0.65)
        .setRestitution(0.12)
        .setCollisionGroups(0x0004000d),
      body,
    );
    this.balls.push({
      id: this.nextId++,
      body,
      collider,
      previous: p,
      age: 0,
      rest: 0,
      airborne: Infinity,
      crushLoss: 0,
      fade: 0,
      grounded: false,
      lastTerrain: null,
      terrainTime: 0,
      dented: false,
      soundAge: 0,
      impactSpeed: 0,
    });
    return true;
  }
  coverage(): { p: Vec3; radius: number }[] {
    return this.balls.map(({ body }) => {
      const p = body.translation();
      const v = body.linvel();
      return {
        p: [p.x, p.y, p.z],
        radius: STEEL_BALL.radius + 8 + Math.hypot(v.x, v.y, v.z) * CONFIG.dt,
      };
    });
  }
  private loseCrushingMomentum(ball: Ball, hits: number) {
    if (!hits) return;
    const loss = Math.min(
      STEEL_BALL.maxCrushLossPerStep,
      ball.crushLoss + hits * STEEL_BALL.crushLossPerHit,
    );
    const factor = (1 - loss) / (1 - ball.crushLoss);
    ball.crushLoss = loss;
    const v = ball.body.linvel();
    ball.body.setLinvel(
      { x: v.x * factor, y: v.y * factor, z: v.z * factor },
      true,
    );
  }
  beforeStep(dt: number) {
    for (const ball of this.balls) {
      const p = ball.body.translation(),
        v = ball.body.linvel();
      ball.previous = [p.x, p.y, p.z];
      ball.crushLoss = 0;
      ball.impactSpeed = Math.max(0, -v.y);
      if (ball.fade) continue;
      const next: Vec3 = [
        p.x + v.x * dt,
        p.y + v.y * dt - CONFIG.debrisGravity * dt * dt,
        p.z + v.z * dt,
      ];
      const hits = this.crush(ball.previous, next, Math.hypot(v.x, v.y, v.z));
      this.loseCrushingMomentum(ball, hits);
    }
  }
  afterStep(dt: number) {
    for (let i = this.balls.length - 1; i >= 0; i--) {
      const ball = this.balls[i],
        p = ball.body.translation(),
        v = ball.body.linvel();
      const position: Vec3 = [p.x, p.y, p.z];
      ball.age += dt;
      ball.soundAge += dt;
      ball.terrainTime += dt;
      const speed = Math.hypot(v.x, v.y, v.z);
      const ground = this.terrain.sample(p.x, p.z);
      let contact = false;
      let terrainContact = false;
      this.physics.contactPairsWith(ball.collider, (other) => {
        if (contact && terrainContact) return;
        this.physics.contactPair(ball.collider, other, (manifold) => {
          if (contact && terrainContact) return;
          if (Math.abs(manifold.normal().y) <= 0.1) return;
          for (let j = 0; j < manifold.numSolverContacts(); j++) {
            if (manifold.solverContactDist(j) > 0.1) continue;
            contact = true;
            if (other.shape.type === RAPIER.ShapeType.HeightField)
              terrainContact = true;
            if (contact && terrainContact) break;
          }
        });
      });
      const supported = contact;
      ball.airborne = supported ? 0 : ball.airborne + dt;
      if (!ball.fade) {
        const hits = this.crush(ball.previous, position, speed);
        this.loseCrushingMomentum(ball, hits);
        if (contact && !ball.grounded && ball.impactSpeed > 3)
          this.impact(
            [p.x, ground, p.z],
            Math.min(2, ball.impactSpeed / 30),
            false,
          );
        if (supported) {
          const current = ball.body.linvel();
          const factor = Math.exp(-STEEL_BALL.rollingResistance * dt);
          ball.body.setLinvel(
            { x: current.x * factor, y: current.y, z: current.z * factor },
            false,
          );
          if (speed > 1 && ball.soundAge >= 0.3) {
            this.impact([p.x, ground, p.z], Math.min(1, speed / 50), true);
            ball.soundAge = 0;
          }
        }
        if (terrainContact && (!ball.dented || ball.terrainTime >= 0.1)) {
          this.terrainDamage(
            ball.lastTerrain ?? position,
            position,
            !ball.dented,
          );
          ball.lastTerrain = position;
          ball.terrainTime = 0;
          ball.dented = true;
        }
        const current = ball.body.linvel();
        const cleanupSpeed = Math.hypot(current.x, current.y, current.z);
        if (
          cleanupSpeed >= STEEL_BALL.slowSpeed ||
          ball.airborne > STEEL_BALL.contactGrace
        )
          ball.rest = 0;
        else if (supported) ball.rest += dt;
        const water = this.terrain.surfaceHeight(p.x, p.z, ground);
        if (
          ball.rest >= STEEL_BALL.slowSeconds ||
          (water !== undefined && p.y + STEEL_BALL.radius < water) ||
          ball.age >= 120
        )
          ball.fade = dt;
      } else ball.fade += dt;
      ball.grounded = contact;
      if (!terrainContact) ball.lastTerrain = null;
      if (
        ball.fade >= 1 ||
        p.x < 0 ||
        p.z < 0 ||
        p.x > CONFIG.worldSize ||
        p.z > CONFIG.worldSize
      ) {
        this.physics.removeRigidBody(ball.body);
        this.balls.splice(i, 1);
      }
    }
  }
  snapshot(): SteelBallState[] {
    return this.balls.map((ball) => {
      const p = ball.body.translation(),
        q = ball.body.rotation();
      return {
        id: ball.id,
        p: [p.x, p.y, p.z],
        q: [q.x, q.y, q.z, q.w],
        fade: ball.fade,
      };
    });
  }
  reset() {
    for (const ball of this.balls) this.physics.removeRigidBody(ball.body);
    this.balls.length = 0;
  }
}
