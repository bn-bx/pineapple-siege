import * as THREE from "three";
import {
  DEFAULT_MONSTER_COUNT,
  MAX_MONSTER_COUNT,
  MONSTER_SCALE,
} from "../config";
import type { SimulationSnapshot, WorldData } from "../types";
import { CivilianView } from "./civilians";
import type { Effects } from "./effects";
import {
  DistantMonsterView,
  MonsterFragmentView,
  NearMonsterView,
  monsterCombatPose,
} from "./monster";
import { ProjectileView } from "./projectiles";
import type { ResourceDisposal } from "./resource-disposal";
import type { TerrainView } from "./terrain-view";
const up = new THREE.Vector3(0, 1, 0);
export class ActorView {
  readonly civilians: CivilianView;
  readonly projectileView = new ProjectileView();
  private monsterFragmentView = new MonsterFragmentView(MAX_MONSTER_COUNT);
  private monsterFragmentRoot = new THREE.Object3D();
  private monsterFragmentQuaternion = new THREE.Quaternion();
  private nearMonsterView = new NearMonsterView(MAX_MONSTER_COUNT);
  private distantMonsterView = new DistantMonsterView(MAX_MONSTER_COUNT);
  private monsterMeshes: THREE.Group[] = [];
  private distantMonsters: THREE.Group[] = [];
  private spikeMeshes: THREE.Mesh[] = [];
  private spikeGeometry: THREE.BufferGeometry = new THREE.ConeGeometry(
    0.75,
    5,
    5,
  );
  private spikeMaterial = new THREE.MeshStandardMaterial({
    color: "#596d3a",
    roughness: 0.78,
    side: THREE.DoubleSide,
  });
  private previousProjectiles = new Map<
    number,
    SimulationSnapshot["projectiles"][number]
  >();
  private previousSpikes = new Map<
    number,
    SimulationSnapshot["monsterSpikes"][number]
  >();
  private previous?: SimulationSnapshot;
  private camera!: THREE.PerspectiveCamera;
  private renderDistance = 1200;
  private frame = 0;
  private elapsed = 0;
  constructor(
    private scene: THREE.Scene,
    world: WorldData,
    private terrain: TerrainView,
    private effects: Effects,
  ) {
    this.civilians = new CivilianView(world.civilians?.length ?? 0);
    this.scene.add(
      this.civilians.group,
      this.projectileView.group,
      this.nearMonsterView.group,
      this.distantMonsterView.group,
      this.monsterFragmentView.group,
    );
    this.ensureMonsterMeshes(DEFAULT_MONSTER_COUNT);
  }
  private ensureMonsterMeshes(count: number) {
    while (this.monsterMeshes.length < count) {
      const monster = new THREE.Group();
      const distant = new THREE.Group();
      monster.visible = distant.visible = false;
      this.monsterMeshes.push(monster);
      this.distantMonsters.push(distant);
      // Attach only visible detail models; hidden hierarchies otherwise still
      // recalculate thousands of world matrices on every frame.
    }
  }
  reset() {
    this.civilians.reset();
    this.projectileView.reset();
    this.previous = undefined;
    this.previousProjectiles.clear();
    this.previousSpikes.clear();
    for (const mesh of [
      ...this.monsterMeshes,
      ...this.distantMonsters,
      ...this.spikeMeshes,
    ])
      mesh.visible = false;
    for (const view of [
      this.nearMonsterView,
      this.distantMonsterView,
      this.monsterFragmentView,
    ]) {
      view.begin();
      view.finish();
    }
  }
  update(
    snap: SimulationSnapshot,
    previous: SimulationSnapshot | undefined,
    alpha: number,
    camera: THREE.PerspectiveCamera,
    renderDistance: number,
    active: boolean,
    frame: number,
    elapsed: number,
    dancing: boolean,
  ) {
    if (this.previous !== previous) {
      this.previous = previous;
      this.previousProjectiles.clear();
      this.previousSpikes.clear();
      for (const shot of previous?.projectiles ?? [])
        this.previousProjectiles.set(shot.id, shot);
      for (const spike of previous?.monsterSpikes ?? [])
        this.previousSpikes.set(spike.id, spike);
    }
    this.camera = camera;
    this.renderDistance = renderDistance;
    this.frame = frame;
    this.elapsed = elapsed;
    this.civilians.update(
      snap,
      this.previous,
      alpha,
      this.camera.position,
      this.renderDistance,
      this.camera,
      (x, z) => this.terrain.sample(x, z),
    );
    this.ensureMonsterMeshes(snap.monsters.length);
    this.monsterFragmentView.begin();
    this.nearMonsterView.begin();
    this.distantMonsterView.begin();
    for (let i = 0; i < this.monsterMeshes.length; i++) {
      const mesh = this.monsterMeshes[i],
        distant = this.distantMonsters[i];
      const m = snap.monsters[i];
      const wreckageScale = THREE.MathUtils.lerp(
        this.previous?.monsters[i]?.cleanupScale ?? 1,
        m?.cleanupScale ?? 1,
        alpha,
      );
      mesh.visible = distant.visible =
        !!m && !m.cleared && (!m.defeated || !!m.ragdoll);
      if (m?.fragments?.length && !m.cleared) {
        const previous = this.previous?.monsters[m.id]?.fragments;
        const root = this.monsterFragmentRoot;
        for (const fragment of m.fragments) {
          if (
            (fragment.p[0] - this.camera.position.x) ** 2 +
              (fragment.p[2] - this.camera.position.z) ** 2 >
            (this.renderDistance + 40) ** 2
          )
            continue;
          const old = previous?.find((p) => p.part === fragment.part);
          root.position.fromArray(fragment.p);
          root.quaternion.fromArray(fragment.q);
          if (old) {
            root.position.set(
              ...(fragment.p.map((v, i) =>
                THREE.MathUtils.lerp(old.p[i], v, alpha),
              ) as [number, number, number]),
            );
            root.quaternion
              .fromArray(old.q)
              .slerp(
                this.monsterFragmentQuaternion.fromArray(fragment.q),
                alpha,
              );
          }
          root.scale.setScalar(MONSTER_SCALE * wreckageScale);
          this.monsterFragmentView.add(fragment.part, root);
        }
        continue;
      }
      if (!m || m.cleared || (m.defeated && !m.ragdoll)) {
        if (mesh.parent) this.scene.remove(mesh);
        if (distant.parent) this.scene.remove(distant);
        continue;
      }
      if (
        (m.p[0] - this.camera.position.x) ** 2 +
          (m.p[2] - this.camera.position.z) ** 2 >
        (this.renderDistance + 90) ** 2
      ) {
        mesh.visible = distant.visible = false;
        if (mesh.parent) this.scene.remove(mesh);
        if (distant.parent) this.scene.remove(distant);
        continue;
      }
      const old = this.previous?.monsters[m.id];
      if (old && old.defeated === m.defeated)
        mesh.position.set(
          THREE.MathUtils.lerp(old.p[0], m.p[0], alpha),
          THREE.MathUtils.lerp(old.p[1], m.p[1], alpha),
          THREE.MathUtils.lerp(old.p[2], m.p[2], alpha),
        );
      else mesh.position.fromArray(m.p);
      if (m.ragdoll) {
        mesh.quaternion.fromArray(m.ragdoll);
        if (old?.ragdoll) {
          mesh.quaternion
            .fromArray(old.ragdoll)
            .slerp(new THREE.Quaternion().fromArray(m.ragdoll), alpha);
        }
        mesh.scale.setScalar(MONSTER_SCALE * wreckageScale);
        distant.position.copy(mesh.position);
        distant.quaternion.copy(mesh.quaternion);
        distant.scale.setScalar(MONSTER_SCALE * wreckageScale);
        if (this.camera.position.distanceTo(mesh.position) < 480) {
          const sway = Math.sin(m.phase) * m.stagger * 0.25;
          this.nearMonsterView.add(mesh, 0.35 + sway, -0.35 - sway, sway * 0.2);
        } else this.distantMonsterView.add(distant);
        continue;
      }
      const beat = Math.sin(snap.time * Math.PI * 4 + m.id * 0.7);
      const crawl = Math.sin(m.phase * 0.2) * (m.stagger > 0 ? 0.05 : 0.23),
        pose = monsterCombatPose(m.phase, m.windup, m.stagger, crawl),
        dance = dancing && !pose.active;
      mesh.rotation.x = pose.lean;
      mesh.rotation.y = m.yaw + (dance ? beat * 0.28 : 0);
      mesh.rotation.z = dance ? beat * 0.1 : 0;
      if (dance) mesh.position.y += Math.max(0, beat) * 2;
      distant.position.copy(mesh.position);
      distant.rotation.y = mesh.rotation.y;
      distant.rotation.z = mesh.rotation.z;
      distant.scale.setScalar(MONSTER_SCALE);
      const detail = this.camera.position.distanceTo(mesh.position) < 480;
      mesh.visible = detail;
      distant.visible = !detail;
      if (mesh.parent) this.scene.remove(mesh);
      if (distant.parent) this.scene.remove(distant);
      if (!detail) {
        this.distantMonsterView.add(distant);
        continue;
      }
      const left = dance ? -0.65 - beat * 0.45 : pose.left,
        right = dance ? 0.65 - beat * 0.45 : pose.right;
      mesh.scale.setScalar(
        MONSTER_SCALE *
          (m.stagger > 0 ? 1 + Math.sin(this.elapsed * 35) * 0.025 : 1),
      );
      this.nearMonsterView.add(
        mesh,
        left,
        right,
        dance ? Math.sin(m.phase * 0.09) * 0.08 : pose.crown,
        pose.brow,
        pose.jaw,
      );
    }
    this.monsterFragmentView.finish();
    this.nearMonsterView.finish();
    this.distantMonsterView.finish();
    while (this.spikeMeshes.length < snap.monsterSpikes.length) {
      const spike = new THREE.Mesh(this.spikeGeometry, this.spikeMaterial);
      spike.scale.setScalar(MONSTER_SCALE);
      this.spikeMeshes.push(spike);
      this.scene.add(spike);
    }
    for (let i = 0; i < this.spikeMeshes.length; i++) {
      const spike = this.spikeMeshes[i],
        s = snap.monsterSpikes[i];
      spike.visible = !!s;
      if (s) {
        const old = this.previousSpikes.get(s.id);
        if (old)
          spike.position.set(
            ...(s.p.map((v, k) => THREE.MathUtils.lerp(old.p[k], v, alpha)) as [
              number,
              number,
              number,
            ]),
          );
        else spike.position.fromArray(s.p);
        spike.quaternion.setFromUnitVectors(
          up,
          new THREE.Vector3(...s.v).normalize(),
        );
      }
    }
    this.projectileView.update(
      snap.projectiles,
      this.previousProjectiles,
      alpha,
    );
    if (active && this.frame % 6 === 0)
      for (const shot of snap.projectiles)
        if (shot.weapon === "cannon") this.effects.trail(shot.p, shot.v);
  }
  get projectileCount() {
    return this.projectileView.count;
  }

  dispose(resources: ResourceDisposal) {
    this.reset();
    for (const group of [
      this.civilians.group,
      this.projectileView.group,
      this.nearMonsterView.group,
      this.distantMonsterView.group,
      this.monsterFragmentView.group,
      ...this.spikeMeshes,
    ]) {
      resources.collect(group);
      group.removeFromParent();
    }
    resources.geometries.add(this.spikeGeometry);
    resources.materials.add(this.spikeMaterial);
    this.spikeMeshes.length = 0;
    this.monsterMeshes.length = 0;
    this.distantMonsters.length = 0;
  }
}
