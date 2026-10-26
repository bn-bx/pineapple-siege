import { Color, MathUtils, Vector3 } from "three";
import { OCEAN_BACKGROUND_GLSL } from "./ocean-horizon";

const palette = {
  sunDay: new Color("#ffe9c7"),
  sunSet: new Color("#ff9865"),
  moon: new Color("#9ebdeb"),
  ambientDay: new Color("#c5e5f4"),
  ambientSet: new Color("#b697c8"),
  ambientNight: new Color("#879fc5"),
  groundDay: new Color("#657344"),
  groundNight: new Color("#3a4c68"),
  zenithDay: new Color("#428bc7"),
  zenithSet: new Color("#645d9c"),
  zenithNight: new Color("#111b35"),
  horizonDay: new Color("#b1d3e1"),
  horizonSet: new Color("#fca579"),
  horizonNight: new Color("#293b58"),
  waterDay: new Color("#285f65"),
  waterSet: new Color("#365e7c"),
  waterNight: new Color("#102940"),
  sunDisc: new Color("#fff4e0"),
  sunLow: new Color("#ff8326"),
};

/**
 * The moon rides opposite the sun, swung this far around the vertical so it
 * isn't exactly anti-solar: it then shows a gibbous phase and rises later than
 * sunset, which reads as a moon rather than a mirrored sun.
 */
export const MOON_AZIMUTH_OFFSET = 0.45;

/** Reused colors/uniform values: hour is authoritative, including in photo mode. */
export class EnvironmentLighting {
  readonly sunDirection = new Vector3();
  /** Direction to the moon; it lights the night instead of a mirrored sun. */
  readonly moonDirection = new Vector3();
  readonly lightDirection = new Vector3();
  /** Sun disc and glow tint: white-gold by day, deep orange at the horizon. */
  readonly sunTint = new Color();
  /** 0 by day, 1 in full night: drives star visibility. */
  starStrength = 0;
  readonly sunColor = new Color();
  readonly ambientColor = new Color();
  readonly groundColor = new Color();
  readonly zenithColor = new Color();
  readonly horizonColor = new Color();
  readonly waterColor = new Color();
  daylight = 1;
  twilight = 0;
  night = 0;
  sunIntensity = 3;
  ambientIntensity = 1.8;

  update(hour: number) {
    const angle = ((hour - 6) / 24) * Math.PI * 2;
    this.sunDirection
      .set(Math.cos(angle) * 0.8, Math.sin(angle), Math.cos(angle) * 0.5)
      .normalize();
    const height = this.sunDirection.y;
    this.daylight = MathUtils.smoothstep(height, -0.18, 0.24);
    this.twilight =
      (1 - MathUtils.smoothstep(Math.abs(height), 0.04, 0.42)) *
      MathUtils.smoothstep(height, -0.25, -0.04);
    this.night = 1 - MathUtils.smoothstep(height, -0.08, 0.18);
    const c = Math.cos(MOON_AZIMUTH_OFFSET),
      s = Math.sin(MOON_AZIMUTH_OFFSET),
      mx = -this.sunDirection.x,
      mz = -this.sunDirection.z;
    this.moonDirection.set(mx * c - mz * s, -this.sunDirection.y, mx * s + mz * c);
    this.lightDirection.copy(height < 0 ? this.moonDirection : this.sunDirection);
    // Low sun passes through more air: redder disc and wider, warmer glow.
    const low = 1 - MathUtils.smoothstep(height, 0.02, 0.35);
    this.sunTint.copy(palette.sunDisc).lerp(palette.sunLow, low);
    this.starStrength = MathUtils.smoothstep(-height, 0.08, 0.3);
    this.sunColor
      .lerpColors(palette.moon, palette.sunDay, this.daylight)
      .lerp(palette.sunSet, this.twilight);
    this.ambientColor
      .lerpColors(palette.ambientNight, palette.ambientDay, this.daylight)
      .lerp(palette.ambientSet, this.twilight * 0.65);
    this.groundColor.lerpColors(
      palette.groundNight,
      palette.groundDay,
      this.daylight,
    );
    this.zenithColor
      .lerpColors(palette.zenithNight, palette.zenithDay, this.daylight)
      .lerp(palette.zenithSet, this.twilight * 0.8);
    this.horizonColor
      .lerpColors(palette.horizonNight, palette.horizonDay, this.daylight)
      .lerp(palette.horizonSet, this.twilight);
    this.waterColor
      .lerpColors(palette.waterNight, palette.waterDay, this.daylight)
      .lerp(palette.waterSet, this.twilight * 0.65);
    // The light switches from sun to moon as the sun crosses the horizon;
    // fading it out on both sides hides the jump in shadow direction.
    const handoff = MathUtils.smoothstep(Math.abs(height), 0.005, 0.07);
    this.sunIntensity = (0.55 + this.daylight * 2.45) * handoff;
    this.ambientIntensity = 0.72 + this.daylight * 0.23;
  }
}

export const SKY_FRAGMENT = `
${OCEAN_BACKGROUND_GLSL}
varying vec3 vDirection;
void main(){
  vec3 d=normalize(vDirection);
  gl_FragColor=vec4(oceanBackground(d),1.);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
