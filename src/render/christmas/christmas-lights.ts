import * as THREE from "three";
import { isRoof } from "../../debris-shape";
import type { Entity } from "../../types";
import { XMAS } from "../../christmas";

/** Metres between bulbs along an eave. */
const SPACING = 2.4;
/** Bulbs strung on any one roof, so castles don't swamp the budget. */
const MAX_PER_ROOF = 64;

/**
 * Strings of coloured bulbs along every roof's eaves, lit at night. One
 * additive point draw like the window glow; a roof that is destroyed loses
 * its string. The space-laser light show makes them chase.
 */
export class ChristmasLights {
  readonly points: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private roofs: Entity[];
  private offsets: number[] = [];
  private counts: number[] = [];
  private positions: Float32Array;
  private colors: Float32Array;
  private phases: Float32Array;
  private all: { p: Float32Array; c: Float32Array; phase: Float32Array };
  private removedSize = -1;

  constructor(entities: readonly Entity[]) {
    this.roofs = entities.filter(
      (e) => e.kind === "block" && isRoof(e.material) && !e.visual,
    );
    const p: number[] = [],
      c: number[] = [],
      phase: number[] = [];
    const color = new THREE.Color();
    for (const roof of this.roofs) {
      this.offsets.push(phase.length);
      const [x, y, z] = roof.p,
        [sx, sy, sz] = roof.s,
        eave = y - sy - 0.15;
      const corners = [
        [x - sx, z - sz],
        [x + sx, z - sz],
        [x + sx, z + sz],
        [x - sx, z + sz],
      ];
      let added = 0;
      for (let side = 0; side < 4 && added < MAX_PER_ROOF; side++) {
        const [ax, az] = corners[side],
          [bx, bz] = corners[(side + 1) % 4],
          length = Math.hypot(bx - ax, bz - az),
          n = Math.max(2, Math.round(length / SPACING));
        for (let i = 0; i < n && added < MAX_PER_ROOF; i++) {
          const t = i / n,
            // Strings sag a little between the corners.
            sag = Math.sin(((i % 4) / 4) * Math.PI) * 0.25;
          p.push(ax + (bx - ax) * t, eave - sag, az + (bz - az) * t);
          color.set(XMAS.bulbs[(i + side + roof.id) % XMAS.bulbs.length]);
          c.push(color.r, color.g, color.b);
          phase.push(i + side * 17 + (roof.id % 97));
          added++;
        }
      }
      this.counts.push(added);
    }
    this.all = {
      p: new Float32Array(p),
      c: new Float32Array(c),
      phase: new Float32Array(phase),
    };
    const n = Math.max(1, phase.length);
    this.positions = new Float32Array(n * 3);
    this.colors = new Float32Array(n * 3);
    this.phases = new Float32Array(n);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    geometry.setAttribute("bulbColor", new THREE.BufferAttribute(this.colors, 3));
    geometry.setAttribute("bulbPhase", new THREE.BufferAttribute(this.phases, 1));
    geometry.setDrawRange(0, 0);
    this.points = new THREE.Points(
      geometry,
      new THREE.ShaderMaterial({
        uniforms: {
          strength: { value: 0 },
          time: { value: 0 },
          chase: { value: 0 },
          viewportHeight: { value: 800 },
        },
        vertexShader: /* glsl */ `
          attribute vec3 bulbColor;
          attribute float bulbPhase;
          uniform float time, chase, viewportHeight;
          varying vec3 vColor;
          varying float vFade;
          void main(){
            vec4 view = modelViewMatrix * vec4(position, 1.);
            float depth = max(-view.z, 1.);
            view.xyz *= max(depth - 1.5, 1.) / depth;
            gl_Position = projectionMatrix * view;
            float size = 1.6 * projectionMatrix[1][1] * viewportHeight / depth;
            gl_PointSize = clamp(size, 1.5, 48.);
            vFade = clamp(size / 1.5, 0.3, 1.);
            float twinkle = .72 + .28 * sin(time * 2.1 + bulbPhase * 1.7);
            // Light-show chase: a bright pulse running along each string.
            float run = pow(.5 + .5 * sin(bulbPhase * .9 - time * 9.), 6.);
            vColor = bulbColor * mix(twinkle, .35 + 2.2 * run, chase);
          }`,
        fragmentShader: /* glsl */ `
          uniform float strength;
          varying vec3 vColor;
          varying float vFade;
          void main(){
            float r = length(gl_PointCoord - .5) * 2.;
            float core = smoothstep(.45, .1, r);
            float glow = pow(max(0., 1. - r), 2.2);
            gl_FragColor = vec4((vColor * glow + vec3(core) * .6) * strength * vFade, 1.);
          }`,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: false,
      }),
    );
    this.points.frustumCulled = false;
    this.points.renderOrder = 4;
  }

  /** `night` 0–1; `show` is the laser light-show strength. */
  update(
    night: number,
    show: number,
    time: number,
    removed: ReadonlySet<number>,
    viewportHeight: number,
  ) {
    const u = this.points.material.uniforms;
    u.strength.value = Math.max(
      THREE.MathUtils.smoothstep(night, 0.1, 0.7) * 0.9,
      show * 1.1,
    );
    u.time.value = time;
    u.chase.value = show;
    u.viewportHeight.value = viewportHeight;
    this.points.visible = u.strength.value > 0.001;
    if (removed.size === this.removedSize) return;
    this.removedSize = removed.size;
    let n = 0;
    this.roofs.forEach((roof, r) => {
      if (removed.has(roof.id)) return;
      const start = this.offsets[r];
      for (let i = start; i < start + this.counts[r]; i++, n++) {
        this.positions.set(this.all.p.subarray(i * 3, i * 3 + 3), n * 3);
        this.colors.set(this.all.c.subarray(i * 3, i * 3 + 3), n * 3);
        this.phases[n] = this.all.phase[i];
      }
    });
    const geometry = this.points.geometry;
    geometry.setDrawRange(0, n);
    for (const name of ["position", "bulbColor", "bulbPhase"])
      geometry.getAttribute(name).needsUpdate = true;
  }

  invalidate() {
    this.removedSize = -1;
  }

  get count() {
    return this.points.geometry.drawRange.count;
  }

  dispose() {
    this.points.geometry.dispose();
    this.points.material.dispose();
  }
}
