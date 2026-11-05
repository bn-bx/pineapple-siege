import * as THREE from "three";

/**
 * A drifting cloud layer drawn analytically inside the sky shader.
 *
 * - From below, no geometry: each sky pixel intersects its ray with a flat
 *   layer at CLOUD_ALTITUDE and reads a small tiling noise texture.
 * - From above, a flat transparent deck follows the camera and covers the
 *   island and sea. It fades out with distance while the sky (and the
 *   sky-drawn far ocean) fades the same clouds in, so there is no seam.
 * - Flying through the layer briefly whites out the view, by the density
 *   at the aircraft.
 * - Cost: 3 texture fetches per cloud pixel (sky below, deck above).
 * - Mipmaps keep the layer from shimmering toward the horizon, where it also
 *   fades into the horizon colour.
 */
export const CLOUD_ALTITUDE = 2200;
export const CLOUD_TEXTURE_SIZE = 256;
/** World metres covered by one repeat of the shape (R) and detail (G) noise. */
export const CLOUD_SHAPE_TILE = 9000;
export const CLOUD_DETAIL_TILE = 2300;
/** Half-thickness (m) of the band around the layer that whites out the view. */
export const CLOUD_WHITEOUT_BAND = 90;
/** Wind drift, metres per second (the detail layer moves 1.6x faster). */
const WIND = new THREE.Vector2(9, 4);

function hash(x: number, y: number, seed: number) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Value noise that repeats every `period` lattice cells. */
function tiledNoise(x: number, y: number, period: number, seed: number) {
  const ix = Math.floor(x),
    iy = Math.floor(y);
  const fx = x - ix,
    fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx),
    uy = fy * fy * (3 - 2 * fy);
  const x0 = ((ix % period) + period) % period,
    y0 = ((iy % period) + period) % period;
  const x1 = (x0 + 1) % period,
    y1 = (y0 + 1) % period;
  const a = hash(x0, y0, seed),
    b = hash(x1, y0, seed),
    c = hash(x0, y1, seed),
    d = hash(x1, y1, seed);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

/** Tileable fBm over [0,1)^2, octaves doubling from `period` cells. */
function fbm(u: number, v: number, period: number, octaves: number, seed: number) {
  let sum = 0,
    amp = 0.5,
    norm = 0,
    p = period;
  for (let o = 0; o < octaves; o++) {
    sum += tiledNoise(u * p, v * p, p, seed + o * 17) * amp;
    norm += amp;
    amp *= 0.5;
    p *= 2;
  }
  return sum / norm;
}

/** Stretches values to the full 0..255 range so coverage thresholds behave. */
function normalize(values: Float32Array, out: Uint8Array, channel: number) {
  let min = Infinity,
    max = -Infinity;
  for (const v of values) {
    min = Math.min(min, v);
    max = Math.max(max, v);
  }
  const scale = 255 / Math.max(max - min, 1e-6);
  for (let i = 0; i < values.length; i++)
    out[i * 4 + channel] = Math.round((values[i] - min) * scale);
}

/** RGBA8 texels: R large cloud shapes, G fine detail; both tile seamlessly. */
export function cloudNoiseData(size = CLOUD_TEXTURE_SIZE) {
  const data = new Uint8Array(size * size * 4);
  const shape = new Float32Array(size * size),
    detail = new Float32Array(size * size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const u = x / size,
        v = y / size,
        i = y * size + x;
      shape[i] = fbm(u, v, 4, 5, 11);
      detail[i] = fbm(u, v, 16, 3, 53);
      data[i * 4 + 3] = 255;
    }
  normalize(shape, data, 0);
  normalize(detail, data, 1);
  return data;
}

/** Cloud density in world XZ at the layer's altitude. */
export const CLOUD_GLSL = /* glsl */ `
uniform sampler2D cloudMap;
uniform vec2 cloudOffset;
uniform float cloudCover, cloudAltitude;
// Large shapes only (one fetch): the light tap.
float cloudCoarse(vec2 p){
  float n=texture2D(cloudMap,(p+cloudOffset)*${(1 / CLOUD_SHAPE_TILE).toExponential(6)}).r;
  float t=1.-cloudCover;
  return smoothstep(t,t+.22,n);
}
float cloudDensity(vec2 p){
  float base=texture2D(cloudMap,(p+cloudOffset)*${(1 / CLOUD_SHAPE_TILE).toExponential(6)}).r;
  float detail=texture2D(cloudMap,(p+cloudOffset*1.6)*${(1 / CLOUD_DETAIL_TILE).toExponential(6)}).g;
  float t=1.-cloudCover;
  return smoothstep(t,t+.2,base*.75+detail*.25);
}
`;

/**
 * Shading shared by the sky and the deck. Expects a `sun` direction uniform.
 * `cloudLayer(d, t, haze)`: colour and opacity where the unit ray `d` from
 * the camera crosses the layer at distance `t`; `haze` is what distant
 * cloud fades toward.
 */
export const CLOUD_SHADING_GLSL = /* glsl */ `
${CLOUD_GLSL}
uniform vec3 cloudLit, cloudShade, cloudLight;
// Horizontal distances over which the deck hands over to the sky (from above).
uniform float cloudFadeNear, cloudFadeFar;
vec4 cloudLayer(vec3 d, float t, vec3 haze){
  vec2 p=cameraPosition.xz+d.xz*t;
  float dens=cloudDensity(p);
  if(dens<.002) return vec4(0.);
  float above=step(cloudAltitude,cameraPosition.y);
  // One tap toward the light: edges facing it are brighter, cores darker.
  // Tops see the light directly; undersides only what gets through.
  vec2 toLight=normalize(cloudLight.xz+vec2(1e-4,0.));
  float shadowed=cloudCoarse(p+toLight*180.);
  float lit=clamp(mix(.62,.9,above)-(shadowed-dens*.6)*.9,0.,1.)*(1.-dens*.3*(1.-above));
  vec3 col=mix(cloudShade,cloudLit,lit);
  // Thin cloud near the sun glows from below (the silver lining).
  float sunUp=smoothstep(-.04,.04,sun.y);
  float forward=pow(max(dot(d,sun),0.),10.);
  col+=cloudLit*forward*(1.-dens)*1.4*sunUp*(1.-above);
  // Distant cloud thins into the haze; grazing views fade out.
  col=mix(col,haze,clamp(1.-exp(-t*.000035),0.,.85));
  return vec4(col,dens*smoothstep(.01,.14,abs(d.y))*.95);
}
`;

/**
 * Sky-side clouds: upward rays from below the layer, or (from above) the
 * downward rays beyond the deck's reach, including the sky-drawn far ocean.
 */
export const CLOUD_SKY_GLSL = /* glsl */ `
${CLOUD_SHADING_GLSL}
vec3 skyClouds(vec3 d, vec3 sky){
  float h=cloudAltitude-cameraPosition.y;
  if(cloudCover<=0.||abs(d.y)<.01||h*d.y<=0.) return sky;
  float t=h/d.y;
  vec4 c=cloudLayer(d,t,sky);
  if(h<0.) c.a*=smoothstep(cloudFadeNear,cloudFadeFar,t*length(d.xz));
  return mix(sky,c.rgb,c.a);
}
`;

/** The deck seen from above: same clouds, faded out where the sky takes over. */
const DECK_VERTEX = /* glsl */ `
varying vec3 vCloudWorld;
void main(){
  vec4 world=modelMatrix*vec4(position,1.);
  vCloudWorld=world.xyz;
  gl_Position=projectionMatrix*viewMatrix*world;
}`;
const DECK_FRAGMENT = /* glsl */ `
uniform vec3 sun, horizonColor;
uniform float laserDim;
${CLOUD_SHADING_GLSL}
varying vec3 vCloudWorld;
void main(){
  vec3 offset=vCloudWorld-cameraPosition;
  float t=length(offset);
  vec4 c=cloudLayer(offset/t,t,horizonColor);
  c.a*=1.-smoothstep(cloudFadeNear,cloudFadeFar,length(offset.xz));
  if(c.a<.003) discard;
  gl_FragColor=vec4(c.rgb*(1.-laserDim),c.a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
const WHITEOUT_FRAGMENT = /* glsl */ `
uniform vec3 cloudLit, cloudShade;
uniform float whiteout;
void main(){
  gl_FragColor=vec4(mix(cloudShade,cloudLit,.75),whiteout);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/** Cloud texture and uniforms, shared by reference with the sky (and ocean backdrop). */
export class CloudLayer {
  readonly texture: THREE.DataTexture;
  readonly uniforms = {
    cloudMap: { value: null as unknown as THREE.DataTexture },
    cloudOffset: { value: new THREE.Vector2() },
    cloudCover: { value: 0.45 },
    cloudAltitude: { value: CLOUD_ALTITUDE },
    cloudLit: { value: new THREE.Color() },
    cloudShade: { value: new THREE.Color() },
    cloudLight: { value: new THREE.Vector3(0, 1, 0) },
    cloudFadeNear: { value: 9000 },
    cloudFadeFar: { value: 12000 },
  };
  /** Cloud seen from above (hidden while the camera is below the layer). */
  readonly deck: THREE.Mesh<THREE.CircleGeometry, THREE.ShaderMaterial>;
  /** Full-screen veil while flying through the layer. */
  readonly whiteout: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private readonly data: Uint8Array;

  /**
   * `sky` supplies the shared `sun`, `horizonColor` and `laserDim`
   * uniforms so the deck matches the sky exactly.
   */
  constructor(
    private enabled = true,
    sky: Record<string, THREE.IUniform> = {
      sun: { value: new THREE.Vector3(0, 1, 0) },
      horizonColor: { value: new THREE.Color() },
      laserDim: { value: 0 },
    },
  ) {
    this.data = cloudNoiseData();
    this.texture = new THREE.DataTexture(
      this.data,
      CLOUD_TEXTURE_SIZE,
      CLOUD_TEXTURE_SIZE,
      THREE.RGBAFormat,
      THREE.UnsignedByteType,
    );
    this.texture.wrapS = this.texture.wrapT = THREE.RepeatWrapping;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.minFilter = THREE.LinearMipmapLinearFilter;
    this.texture.generateMipmaps = true;
    this.texture.needsUpdate = true;
    this.uniforms.cloudMap.value = this.texture;
    if (!enabled) this.uniforms.cloudCover.value = 0;
    this.deck = new THREE.Mesh(
      new THREE.CircleGeometry(1, 64).rotateX(-Math.PI / 2),
      new THREE.ShaderMaterial({
        uniforms: {
          ...this.uniforms,
          sun: sky.sun,
          horizonColor: sky.horizonColor,
          laserDim: sky.laserDim,
        },
        vertexShader: DECK_VERTEX,
        fragmentShader: DECK_FRAGMENT,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    this.deck.frustumCulled = false;
    this.deck.visible = false;
    this.whiteout = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({
        uniforms: {
          cloudLit: this.uniforms.cloudLit,
          cloudShade: this.uniforms.cloudShade,
          whiteout: { value: 0 },
        },
        vertexShader: "void main(){gl_Position=vec4(position.xy,0.,1.);}",
        fragmentShader: WHITEOUT_FRAGMENT,
        transparent: true,
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.whiteout.frustumCulled = false;
    this.whiteout.renderOrder = 1e6;
    this.whiteout.visible = false;
  }

  /** Same density as the shader's `cloudDensity`, at world XZ (CPU, no mips). */
  densityAt(x: number, z: number) {
    const u = this.uniforms,
      off = u.cloudOffset.value;
    const base = this.sample(
      ((x + off.x) / CLOUD_SHAPE_TILE) * CLOUD_TEXTURE_SIZE,
      ((z + off.y) / CLOUD_SHAPE_TILE) * CLOUD_TEXTURE_SIZE,
      0,
    );
    const detail = this.sample(
      ((x + off.x * 1.6) / CLOUD_DETAIL_TILE) * CLOUD_TEXTURE_SIZE,
      ((z + off.y * 1.6) / CLOUD_DETAIL_TILE) * CLOUD_TEXTURE_SIZE,
      1,
    );
    const t = 1 - u.cloudCover.value;
    return THREE.MathUtils.smoothstep(base * 0.75 + detail * 0.25, t, t + 0.2);
  }

  /** Bilinear, repeating texel read of one channel (0..1), texel centres at +0.5. */
  private sample(px: number, py: number, channel: number) {
    const n = CLOUD_TEXTURE_SIZE;
    const fx = px - 0.5,
      fy = py - 0.5;
    const x0 = Math.floor(fx),
      y0 = Math.floor(fy);
    const tx = fx - x0,
      ty = fy - y0;
    const at = (x: number, y: number) =>
      this.data[((((y % n) + n) % n) * n + (((x % n) + n) % n)) * 4 + channel] / 255;
    const top = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * tx;
    const bottom = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * tx;
    return top + (bottom - top) * ty;
  }

  /**
   * Follows the camera: shows the deck above the layer, sizes the deck/sky
   * handover to the view distance, and whites out inside the layer.
   */
  place(camera: THREE.PerspectiveCamera) {
    const above = camera.position.y > CLOUD_ALTITUDE;
    const radius = camera.far * 0.8;
    this.uniforms.cloudFadeNear.value = radius * 0.7;
    this.uniforms.cloudFadeFar.value = radius;
    this.deck.visible = this.enabled && above;
    this.deck.position.set(camera.position.x, CLOUD_ALTITUDE, camera.position.z);
    this.deck.scale.setScalar(radius);
    const depth = Math.abs(camera.position.y - CLOUD_ALTITUDE);
    const veil =
      this.enabled && depth < CLOUD_WHITEOUT_BAND
        ? this.densityAt(camera.position.x, camera.position.z) *
          (1 - depth / CLOUD_WHITEOUT_BAND) *
          0.92
        : 0;
    this.whiteout.material.uniforms.whiteout.value = veil;
    this.whiteout.visible = veil > 0.003;
  }

  /**
   * `time` in seconds drives drift and a slow change in coverage. Colours
   * follow the sky: white by day, warm at sunset, moonlit grey at night.
   */
  update(
    time: number,
    lighting: {
      daylight: number;
      twilight: number;
      moonIllumination: number;
      sunColor: THREE.Color;
      zenithColor: THREE.Color;
      horizonColor: THREE.Color;
      lightDirection: THREE.Vector3;
    },
  ) {
    const u = this.uniforms;
    u.cloudOffset.value.copy(WIND).multiplyScalar(time);
    u.cloudCover.value = this.enabled
      ? 0.47 + 0.12 * Math.sin(time * 0.0021) + 0.05 * Math.sin(time * 0.0087 + 1.3)
      : 0;
    const night = (0.07 + 0.11 * lighting.moonIllumination) * (1 - lighting.daylight);
    const brightness = lighting.daylight * 1.05 + night + lighting.twilight * 0.55;
    u.cloudLit.value.copy(lighting.sunColor).multiplyScalar(brightness);
    u.cloudShade.value
      .copy(lighting.horizonColor)
      .multiplyScalar(0.62)
      .lerp(lighting.zenithColor, 0.25);
    u.cloudLight.value.copy(lighting.lightDirection);
  }

  dispose() {
    this.texture.dispose();
    for (const mesh of [this.deck, this.whiteout]) {
      mesh.removeFromParent();
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
  }
}
