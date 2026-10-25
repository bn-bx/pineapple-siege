import * as THREE from "three";
import type { TerrainView } from "./terrain-view";
import { terrainSurfaceColor } from "./terrain-colors";
import { makeCoastalSurf } from "./coastal-surf";

export type ShorePoint = readonly [number, number];
export type ShoreSegment = readonly [ShorePoint, ShorePoint];

/** March the actual zero contour, rather than assuming a circular island. */
export function shorelineSegments(
  size: number,
  sample: (x: number, z: number) => number,
  step = 24,
): ShoreSegment[] {
  const cells = Math.ceil(size / step),
    side = cells + 1;
  const heights = new Float32Array(side * side);
  for (let z = 0; z <= cells; z++)
    for (let x = 0; x <= cells; x++)
      heights[z * side + x] = sample(
        Math.min(size, x * step),
        Math.min(size, z * step),
      );
  const segments: ShoreSegment[] = [];
  for (let z = 0; z < cells; z++)
    for (let x = 0; x < cells; x++) {
      const a = heights[z * side + x],
        b = heights[z * side + x + 1],
        c = heights[(z + 1) * side + x + 1],
        d = heights[(z + 1) * side + x];
      if (a > 0 === b > 0 && a > 0 === c > 0 && a > 0 === d > 0) continue;
      const points: ShorePoint[] = [
        [x * step, z * step],
        [Math.min(size, (x + 1) * step), z * step],
        [Math.min(size, (x + 1) * step), Math.min(size, (z + 1) * step)],
        [x * step, Math.min(size, (z + 1) * step)],
      ];
      const h = [a, b, c, d];
      const crossings: ShorePoint[] = [];
      for (let i = 0; i < 4; i++) {
        const j = (i + 1) % 4;
        if (h[i] > 0 === h[j] > 0) continue;
        const t = h[i] / (h[i] - h[j]);
        crossings.push([
          points[i][0] + (points[j][0] - points[i][0]) * t,
          points[i][1] + (points[j][1] - points[i][1]) * t,
        ]);
      }
      // Resolve saddle cells using their center height so coves stay connected.
      if (
        crossings.length === 4 &&
        sample((x + 0.5) * step, (z + 0.5) * step) > 0
      )
        crossings.push(crossings.shift()!);
      for (let i = 0; i + 1 < crossings.length; i += 2)
        if (
          Math.hypot(
            crossings[i][0] - crossings[i + 1][0],
            crossings[i][1] - crossings[i + 1][1],
          ) > 0.1
        )
          segments.push([crossings[i], crossings[i + 1]]);
    }
  return segments;
}

interface Rock {
  x: number;
  z: number;
  ground: number;
  rise: number;
  scale: THREE.Vector3;
  rotation: THREE.Euler;
}

/** Actual beach ribbons, cliff outcrops, talus and sea stacks, in three draws. */
export class CoastlineView {
  readonly group = new THREE.Group();
  readonly beach: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  readonly rocks: THREE.InstancedMesh;
  readonly foam: THREE.InstancedMesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  readonly surf: ReturnType<typeof makeCoastalSurf>;
  private anchors: Rock[] = [];
  private originalY: Float32Array;
  private originalColors: Float32Array;
  private terrainRevision: number;
  private refreshVertex = 0;
  private refreshRock = 0;
  private refreshing = false;
  private dummy = new THREE.Object3D();

  constructor(private terrain: TerrainView) {
    this.group.name = "Coastline: beaches, cliffs and sea stacks";
    const size = terrain.world.size;
    const base = (x: number, z: number) => terrain.sample(x, z, terrain.base);
    const segments = shorelineSegments(size, base);
    const sites = terrain.world.sites ?? [];
    const seed = terrain.world.seed ?? 1;
    const random = (x: number, z: number, salt: number) => {
      const n =
        Math.sin(x * 127.1 + z * 311.7 + seed * 0.013 + salt * 74.7) *
        43758.5453;
      return n - Math.floor(n);
    };
    const exposure = (x: number, z: number) =>
      0.5 + 0.5 * Math.sin(x * 0.0031 + Math.sin(z * 0.0027) * 2.3 + seed);
    const frame = ([x, z]: ShorePoint) => {
      const dx = base(x + 6, z) - base(x - 6, z);
      const dz = base(x, z + 6) - base(x, z - 6);
      const length = Math.hypot(dx, dz);
      return {
        x,
        z,
        nx: dx / (length || 1),
        nz: dz / (length || 1),
        slope: length / 12,
      };
    };
    const positions: number[] = [],
      colors: number[] = [],
      indices: number[] = [];
    const color = new THREE.Color();
    const widthAt = (f: ReturnType<typeof frame>) =>
      (52 + 34 * (1 - exposure(f.x, f.z))) /
      (1 + Math.max(0, f.slope - 0.6) * 1.4);
    const cliffPositions: number[] = [],
      cliffColors: number[] = [];
    const cliffTriangle = (
      points: number[][],
      shade: number,
      grass = false,
    ) => {
      for (const [x, y, z] of points) {
        cliffPositions.push(x, y, z);
        if (grass)
          terrainSurfaceColor(
            color,
            x,
            z,
            base(x, z),
            0.2,
            terrain.world.regions,
          );
        else color.setRGB(shade, shade * 0.94, shade * 0.81);
        cliffColors.push(color.r, color.g, color.b);
      }
    };
    for (const segment of segments) {
      const frames = segment.map(frame);
      const start = positions.length / 3;
      for (const f of frames) {
        const width = widthAt(f);
        for (let j = 0; j <= 8; j++) {
          const t = j / 8;
          const distance = -9 + (width + 9) * t;
          const x = f.x + f.nx * distance,
            z = f.z + f.nz * distance;
          const h = base(x, z);
          positions.push(x, h + 0.12 + Math.sin(t * Math.PI) * 0.48, z);
          const dry = THREE.MathUtils.smoothstep(h, -0.5, 3.5);
          color.setRGB(0.37 + dry * 0.34, 0.26 + dry * 0.25, 0.13 + dry * 0.13);
          // Feather the dunes into the existing vegetation at the inland edge.
          const fade = THREE.MathUtils.smoothstep(t, 0.72, 1);
          const ground = new THREE.Color();
          terrainSurfaceColor(ground, x, z, h, f.slope, terrain.world.regions);
          color.lerp(ground, fade);
          colors.push(color.r, color.g, color.b);
        }
      }
      for (let j = 0; j < 8; j++) {
        const a = start + j,
          b = a + 9;
        indices.push(a, b, a + 1, a + 1, b, b + 1);
      }

      const a = frames[0],
        b = frames[1];
      const x = (a.x + b.x) * 0.5,
        z = (a.z + b.z) * 0.5;
      const nx = (a.nx + b.nx) * 0.5,
        nz = (a.nz + b.nz) * 0.5;
      const rugged = exposure(x, z);
      // Keep docks, coastal buildings and their approach water unobstructed.
      if (
        sites.some(
          (site) => Math.hypot(site.p[0] - x, site.p[2] - z) < site.radius + 80,
        )
      )
        continue;
      if (rugged > 0.32) {
        const middle = frame([x, z]);
        const ledge = [frames[0], middle, frames[1]].map((f) => {
          const width = widthAt(f);
          const wobble = Math.sin(f.x * 0.17 + f.z * 0.11) * 1.5;
          const distance =
            width * (0.56 + Math.sin(f.x * 0.006 + f.z * 0.009) * 0.08) +
            wobble;
          const px = f.x + f.nx * distance,
            pz = f.z + f.nz * distance;
          const foot = base(px, pz) + 0.22;
          const rise =
            3.5 + rugged * 5 + Math.sin(f.x * 0.12 + f.z * 0.08) * 1.3;
          const front = [px, pz];
          const back = [px + f.nx * 13, pz + f.nz * 13];
          return [
            [front[0], foot, front[1]],
            [front[0] + f.nx * 2, foot + rise, front[1] + f.nz * 2],
            [
              back[0],
              Math.max(base(back[0], back[1]) + 0.22, foot + rise - 1.8),
              back[1],
            ],
          ];
        });
        for (let k = 0; k < 2; k++) {
          const a = ledge[k],
            b = ledge[k + 1];
          const shade = 0.24 + random(x, z, 400 + k) * 0.12;
          cliffTriangle([a[0], b[0], a[1]], shade);
          cliffTriangle([a[1], b[0], b[1]], shade + 0.035);
          cliffTriangle([a[1], b[1], a[2]], shade + 0.045);
          cliffTriangle([a[2], b[1], b[2]], shade + 0.02, true);
        }
      }
      // Quiet sandy coves alternate with long, connected rocky headlands.
      if (random(x, z, 1) > 0.26 + rugged * 0.4) continue;
      const count = rugged > 0.6 ? 3 : 2;
      for (let k = 0; k < count; k++) {
        const r = random(x, z, k + 2),
          q = random(x, z, k + 30);
        const inland = -12 + r * 25;
        const along = (q - 0.5) * 30;
        const rx = x + nx * inland - nz * along;
        const rz = z + nz * inland + nx * along;
        const h = base(rx, rz);
        if (h < -12 || h > 55) continue;
        const radius = 1.6 + r * 4.2 + (rugged > 0.8 && q > 0.8 ? 3 : 0);
        this.anchors.push({
          x: rx,
          z: rz,
          ground: h,
          rise: radius * 0.2,
          scale: new THREE.Vector3(
            radius * (1.1 + q * 0.6),
            radius * (0.65 + rugged * 0.4),
            radius * (0.8 + r * 0.6),
          ),
          rotation: new THREE.Euler(r * 0.7, q * Math.PI * 2, q * 0.45),
        });
      }
      if (rugged > 0.72 && random(x, z, 99) > 0.8) {
        const rx = x - nx * 25,
          rz = z - nz * 25,
          h = base(rx, rz);
        if (h > -22 && h < -2)
          this.anchors.push({
            x: rx,
            z: rz,
            ground: h,
            rise: 3,
            scale: new THREE.Vector3(7, 10 + rugged * 6, 6),
            rotation: new THREE.Euler(0.12, rugged * 8, 0.16),
          });
      }
    }
    const shoreVertexCount = positions.length / 3;
    const cliffStart = positions.length / 3;
    for (let i = 0; i < cliffPositions.length; i++)
      positions.push(cliffPositions[i]);
    for (let i = 0; i < cliffColors.length; i++) colors.push(cliffColors[i]);
    for (let i = 0; i < cliffPositions.length / 3; i++)
      indices.push(cliffStart + i);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3),
    );
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    const sand = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 1,
      side: THREE.DoubleSide,
    });
    sand.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          "#include <common>\nvarying vec3 beachWorld;",
        )
        .replace(
          "#include <begin_vertex>",
          "#include <begin_vertex>\nbeachWorld=(modelMatrix*vec4(transformed,1.)).xyz;",
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          "#include <common>\nvarying vec3 beachWorld;",
        )
        .replace(
          "#include <color_fragment>",
          `#include <color_fragment>
          float grain=sin(beachWorld.x*2.3+sin(beachWorld.z*1.7))*sin(beachWorld.z*3.1);
          float dune=sin(beachWorld.x*.23+beachWorld.z*.19+sin(beachWorld.z*.047)*2.);
          diffuseColor.rgb*=.97+grain*.035+dune*.025;`,
        );
    };
    sand.customProgramCacheKey = () => "coastal-sand-grain-v1";
    this.beach = new THREE.Mesh(geometry, sand);
    this.beach.userData.shoreVertexCount = shoreVertexCount;
    this.beach.name = "Wide sand beaches and wet sand";
    this.beach.receiveShadow = true;
    // Slightly irregular flat faces read as rocks from both flight and ground views.
    const rockGeometry = new THREE.DodecahedronGeometry(1, 0);
    const rp = rockGeometry.getAttribute("position");
    for (let i = 0; i < rp.count; i++) {
      const x = rp.getX(i),
        y = rp.getY(i),
        z = rp.getZ(i);
      const scale = 1 + 0.13 * Math.sin(x * 17 + y * 23 + z * 11);
      rp.setXYZ(i, x * scale, y * scale, z * scale);
    }
    rockGeometry.computeVertexNormals();
    const stone = new THREE.MeshStandardMaterial({
      color: "#70736e",
      roughness: 0.96,
      flatShading: true,
    });
    stone.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          "#include <common>\nvarying vec3 coastalRockWorld;",
        )
        .replace(
          "#include <begin_vertex>",
          "#include <begin_vertex>\ncoastalRockWorld=(modelMatrix*instanceMatrix*vec4(transformed,1.)).xyz;",
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          "#include <common>\nvarying vec3 coastalRockWorld;",
        )
        .replace(
          "#include <color_fragment>",
          `#include <color_fragment>
          float wetStone=1.-smoothstep(.5,4.,coastalRockWorld.y);
          float layer=sin(coastalRockWorld.y*.72+sin(coastalRockWorld.x*.09)*1.3)*.045;
          diffuseColor.rgb*=1.-wetStone*.42+layer;`,
        );
    };
    stone.customProgramCacheKey = () => "wet-coastal-stone-v1";
    this.rocks = new THREE.InstancedMesh(
      rockGeometry,
      stone,
      this.anchors.length,
    );
    this.rocks.name = "Coastal cliffs, boulders, talus and offshore sea stacks";
    this.rocks.receiveShadow = true;
    this.rocks.castShadow = true;
    const foamMaterial = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: { time: { value: 0 }, brightness: { value: 1 } },
      vertexShader: `varying vec2 foamUv; varying vec3 foamWorld;
        void main(){foamUv=uv*2.-1.;vec4 p=instanceMatrix*vec4(position,1.);
          foamWorld=(modelMatrix*p).xyz;gl_Position=projectionMatrix*modelViewMatrix*p;}`,
      fragmentShader: `uniform float time,brightness;varying vec2 foamUv;varying vec3 foamWorld;
        void main(){float angle=atan(foamUv.y,foamUv.x);
          float ragged=sin(angle*7.+foamWorld.x*.1)*.045+sin(angle*13.-time*.6)*.025;
          float r=length(foamUv)+ragged;
          float pulse=sin(time*.85+foamWorld.x*.07+foamWorld.z*.05)*.035;
          float aa=max(.014,fwidth(r));
          float inner=(1.-smoothstep(.7+aa,.76+aa,r))*smoothstep(.51-aa,.62+aa,r);
          float outer=(1.-smoothstep(.84+pulse,.91+pulse,r))*smoothstep(.78+pulse,.83+pulse,r);
          float broken=.65+.35*sin(angle*9.+sin(angle*4.)-time*.4);
          float alpha=(inner*.7+outer*.35)*broken;
          if(alpha<.015)discard;
          gl_FragColor=vec4(vec3(.8,.94,.91)*brightness,alpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.foam = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2),
      foamMaterial,
      this.anchors.length,
    );
    this.foam.name = "Broken surf around coastal rocks";
    this.foam.renderOrder = 1;
    this.anchors.forEach((rock, i) => {
      this.setRock(i, rock.ground);
      const shade = 0.72 + random(rock.x, rock.z, 188) * 0.38;
      this.rocks.setColorAt(
        i,
        new THREE.Color().setRGB(shade, shade * 0.98, shade * 0.91),
      );
    });
    this.rocks.computeBoundingSphere();
    this.foam.computeBoundingSphere();
    this.surf = makeCoastalSurf(segments, base, terrain);
    this.group.add(this.beach, this.rocks, this.foam, this.surf);
    this.originalY = new Float32Array(positions.filter((_, i) => i % 3 === 1));
    this.originalColors = new Float32Array(colors);
    this.terrainRevision = terrain.surfaceRevision;
    this.refreshing = true;
  }

  private setRock(index: number, height: number) {
    const rock = this.anchors[index];
    // Rock foundations follow excavation instead of hovering over new craters.
    this.dummy.position.set(rock.x, height + rock.rise, rock.z);
    this.dummy.rotation.copy(rock.rotation);
    this.dummy.scale.copy(rock.scale);
    this.dummy.updateMatrix();
    this.rocks.setMatrixAt(index, this.dummy.matrix);
    const waterline = (height + rock.rise) / rock.scale.y;
    const radius =
      Math.abs(waterline) < 0.97
        ? Math.sqrt(1 - waterline * waterline) * 1.6
        : 0;
    this.dummy.position.set(rock.x, 0.1, rock.z);
    this.dummy.rotation.set(0, rock.rotation.y, 0);
    this.dummy.scale.set(rock.scale.x * radius, 1, rock.scale.z * radius);
    this.dummy.updateMatrix();
    this.foam.setMatrixAt(index, this.dummy.matrix);
  }

  update(time = 0, brightness = 1) {
    this.surf.material.uniforms.time.value = time;
    this.surf.material.uniforms.brightness.value = brightness;
    this.foam.material.uniforms.time.value = time;
    this.foam.material.uniforms.brightness.value = brightness;
    if (
      this.terrainRevision !== this.terrain.surfaceRevision &&
      !this.refreshing
    ) {
      this.terrainRevision = this.terrain.surfaceRevision;
      this.refreshVertex = this.refreshRock = 0;
      this.refreshing = true;
    }
    if (!this.refreshing) return;
    const p = this.beach.geometry.getAttribute(
      "position",
    ) as THREE.BufferAttribute;
    const colors = this.beach.geometry.getAttribute(
      "color",
    ) as THREE.BufferAttribute;
    const end = Math.min(p.count, this.refreshVertex + 1536);
    for (let i = this.refreshVertex; i < end; i++) {
      const x = p.getX(i),
        z = p.getZ(i);
      const damage =
        this.terrain.sample(x, z) -
        this.terrain.sample(x, z, this.terrain.base);
      p.setY(i, this.originalY[i] + damage);
      const char = 1 - THREE.MathUtils.clamp(-damage / 3, 0, 0.75);
      colors.setXYZ(
        i,
        this.originalColors[i * 3] * char,
        this.originalColors[i * 3 + 1] * char,
        this.originalColors[i * 3 + 2] * char,
      );
    }
    if (end > this.refreshVertex) {
      p.addUpdateRange(this.refreshVertex * 3, (end - this.refreshVertex) * 3);
      colors.addUpdateRange(
        this.refreshVertex * 3,
        (end - this.refreshVertex) * 3,
      );
      p.needsUpdate = colors.needsUpdate = true;
    }
    this.refreshVertex = end;
    const rockEnd = Math.min(this.anchors.length, this.refreshRock + 128);
    for (let i = this.refreshRock; i < rockEnd; i++)
      this.setRock(
        i,
        this.terrain.sample(this.anchors[i].x, this.anchors[i].z),
      );
    if (rockEnd > this.refreshRock) {
      this.rocks.instanceMatrix.addUpdateRange(
        this.refreshRock * 16,
        (rockEnd - this.refreshRock) * 16,
      );
      this.foam.instanceMatrix.addUpdateRange(
        this.refreshRock * 16,
        (rockEnd - this.refreshRock) * 16,
      );
      this.rocks.instanceMatrix.needsUpdate = true;
      this.foam.instanceMatrix.needsUpdate = true;
    }
    this.refreshRock = rockEnd;
    this.refreshing =
      this.refreshVertex < p.count || this.refreshRock < this.anchors.length;
  }
}
