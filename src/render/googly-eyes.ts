import * as THREE from "three";
import { copyTreeLOD } from "./tree-lod";
import type { SimulationSnapshot } from "../types";

const vertexShader = `
uniform vec3 boundsCenter, boundsSize, jet;
varying vec2 eyeUv;
varying vec3 targetDelta;
varying float eyeRadius;
#include <fog_pars_vertex>
void main() {
  mat4 transform = modelMatrix;
  #ifdef USE_INSTANCING
    transform = modelMatrix * instanceMatrix;
  #endif
  vec3 center = (transform * vec4(boundsCenter, 1.0)).xyz;
  vec3 lengths = vec3(length(transform[0].xyz), length(transform[1].xyz), length(transform[2].xyz));
  vec3 size = boundsSize * lengths;
  mat3 axes = mat3(transform[0].xyz / max(lengths.x, .0001),
                   transform[1].xyz / max(lengths.y, .0001),
                   transform[2].xyz / max(lengths.z, .0001));
  vec3 forward = normalize(cameraPosition - center);
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 localForward = forward * axes;
  float width = dot(abs(right * axes), size);
  float height = dot(abs(up * axes), size);
  float radius = .28 * min(width, height * 1.7);
  // The ray meets the object's front surface. A small stand-off keeps the
  // round shells outside angled masonry instead of drawing through walls.
  vec3 surfaces = size / max(abs(localForward), vec3(.0001));
  float surface = min(surfaces.x, min(surfaces.y, surfaces.z));
  vec3 anchor = center + forward * (surface + radius * .85);
  vec3 target = jet - anchor;
  targetDelta = vec3(dot(target, right), dot(target, up), dot(target, forward));
  eyeRadius = radius;
  eyeUv = uv * vec2(5., 2.3) - vec2(2.5, 1.15);
  vec3 world = anchor + (right * eyeUv.x + up * eyeUv.y) * radius;
  vec4 mvPosition = viewMatrix * vec4(world, 1.);
  gl_Position = projectionMatrix * mvPosition;
  // Removed instances have zero scales; never leave their eyes behind.
  if (min(lengths.x, min(lengths.y, lengths.z)) < .00001 || radius < .015)
    gl_Position = vec4(2., 2., 2., 1.);
  #include <fog_vertex>
}`;

const fragmentShader = `
varying vec2 eyeUv;
varying vec3 targetDelta;
varying float eyeRadius;
#include <fog_pars_fragment>
void main() {
  float side = eyeUv.x < 0. ? -1. : 1.;
  vec2 p = eyeUv - vec2(side * 1.18, 0.);
  // Mismatched bone-white shells and tiny, vacant pupils.
  p /= side < 0. ? .96 : 1.;
  float r = length(p);
  float aa = max(fwidth(r), .008);
  if (r > 1.) discard;
  vec3 white = vec3(.87, .845, .76) * (.94 + .06 * sqrt(max(0., 1. - r*r)));
  vec3 color = mix(vec3(.24, .225, .21), white, 1. - smoothstep(.89, .97, r));
  // Each pupil aims from its own eye center at the rendered jet. Strong,
  // constrained travel makes the focus readable without wandering or glints.
  vec3 sight = normalize(targetDelta - vec3(side * 1.18 * eyeRadius, 0., 0.) + vec3(.0001));
  vec2 pupil = p - sight.xy * .58;
  float pupilRadius = length(pupil);
  color = mix(color, vec3(.008, .006, .004), 1. - smoothstep(.17-aa, .17+aa, pupilRadius));
  gl_FragColor = vec4(color, 1. - smoothstep(1.-aa, 1., r));
  #include <fog_fragment>
  #include <colorspace_fragment>
}`;

/** One tiny eye billboard per object/instance; source transforms stay on the GPU. */
export class GooglyEyes {
  private enabled = true;
  private geometry = new THREE.PlaneGeometry(1, 1);
  private jet = { value: new THREE.Vector3() };
  private entries = new Map<THREE.Object3D, THREE.Mesh>();
  private seen = new Set<THREE.Object3D>();
  private roots = new Set<THREE.Object3D>();
  private membership = new Map<THREE.Object3D, THREE.Object3D>();
  private currentRoot!: THREE.Object3D;

  /** Groups can supply a single face instead of giving every limb its own eyes. */
  private visit = (source: THREE.Object3D) => {
    if (!source.visible || source.name === "googly-eyes") return;
    const bounds = source.userData.googlyBounds as number[] | undefined;
    if (!bounds && !(source instanceof THREE.Mesh)) {
      for (const child of source.children) this.visit(child);
      return;
    }
    this.seen.add(source);
    let eyes = this.entries.get(source);
    if (!eyes) {
      let center: THREE.Vector3, size: THREE.Vector3;
      if (bounds) {
        center = new THREE.Vector3(...bounds.slice(0, 3));
        size = new THREE.Vector3(...bounds.slice(3, 6));
      } else {
        const geometry = (source as THREE.Mesh).geometry;
        if (!geometry.boundingBox) geometry.computeBoundingBox();
        center = geometry.boundingBox!.getCenter(new THREE.Vector3());
        size = geometry
          .boundingBox!.getSize(new THREE.Vector3())
          .multiplyScalar(0.5);
        // Flags and other flat surfaces still get a proper face.
        size.max(new THREE.Vector3(0.04, 0.04, 0.04));
      }
      const material = new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader,
        uniforms: {
          ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
          boundsCenter: { value: center },
          boundsSize: { value: size },
          jet: this.jet,
        },
        transparent: true,
        depthWrite: false,
        fog: true,
        toneMapped: false,
      });
      if (source instanceof THREE.Mesh) {
        const surface = Array.isArray(source.material)
          ? source.material[0]
          : source.material;
        copyTreeLOD(surface, material);
      }
      if (source instanceof THREE.InstancedMesh) {
        eyes = new THREE.InstancedMesh(this.geometry, material, 1);
        (eyes as THREE.InstancedMesh).instanceMatrix = source.instanceMatrix;
      } else eyes = new THREE.Mesh(this.geometry, material);
      eyes.name = "googly-eyes";
      eyes.frustumCulled = false;
      eyes.renderOrder = 2;
      source.add(eyes);
      this.entries.set(source, eyes);
      this.membership.set(source, this.currentRoot);
    }
    if (source instanceof THREE.InstancedMesh) {
      const instanced = eyes as THREE.InstancedMesh;
      instanced.instanceMatrix = source.instanceMatrix;
      instanced.count = source.count;
    }
    eyes.visible = this.enabled;
  };

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    for (const eyes of this.entries.values()) eyes.visible = enabled;
  }

  update(
    roots: THREE.Object3D[],
    snapshot: SimulationSnapshot,
    jetPosition?: THREE.Vector3,
  ) {
    if (!this.enabled) return;
    if (jetPosition) this.jet.value.copy(jetPosition);
    else this.jet.value.fromArray(snapshot.plane.p);
    this.seen.clear();
    this.roots.clear();
    for (const root of roots) {
      this.roots.add(root);
      this.currentRoot = root;
      this.visit(root);
    }
    // Settled batches, reset projectiles and vaporized rubble retire cleanly.
    for (const [source, eyes] of this.entries) {
      if (this.seen.has(source)) continue;
      if (this.roots.has(this.membership.get(source)!)) {
        eyes.visible = false;
        continue;
      }
      this.membership.delete(source);
      source.remove(eyes);
      (eyes.material as THREE.Material).dispose();
      if (eyes instanceof THREE.InstancedMesh) {
        // Three's dispose listener deletes the instance GPU buffer. This one
        // belongs to the source, which may still be rendered elsewhere.
        eyes.instanceMatrix = new THREE.InstancedBufferAttribute(
          new Float32Array(16),
          16,
        );
        eyes.dispose();
      }
      this.entries.delete(source);
    }
  }

  dispose() {
    for (const [source, eyes] of this.entries) {
      source.remove(eyes);
      (eyes.material as THREE.Material).dispose();
      if (eyes instanceof THREE.InstancedMesh) {
        eyes.instanceMatrix = new THREE.InstancedBufferAttribute(
          new Float32Array(16),
          16,
        );
        eyes.dispose();
      }
    }
    this.entries.clear();
    this.membership.clear();
    this.roots.clear();
    this.geometry.dispose();
  }
  get count() {
    if (!this.enabled) return 0;
    let count = 0;
    for (const [source, eyes] of this.entries) {
      let visible = true;
      for (
        let parent: THREE.Object3D | null = source;
        parent;
        parent = parent.parent
      )
        visible &&= parent.visible;
      if (visible)
        count += eyes instanceof THREE.InstancedMesh ? eyes.count : 1;
    }
    return count;
  }
}
