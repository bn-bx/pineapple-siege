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

/** Observer latitude: the sun arcs through the southern sky, peaking at 68 deg. */
export const LATITUDE = MathUtils.degToRad(22);
/** Game days per lunar cycle; the moon rises about 3 h later each day. */
export const LUNAR_DAYS = 8;
/** Sun-moon elongation at day 0, hour 0: a waxing gibbous moon, up by mid-afternoon. */
export const MOON_START_ELONGATION = MathUtils.degToRad(95);
/** Largest lunar declination swing, so the moon's arc differs from the sun's. */
const MOON_DECLINATION = MathUtils.degToRad(18);
/** World directions of local east (where the sun rises) and north. */
const EAST = new Vector3(0.8, 0, 0.5).normalize();
const NORTH = new Vector3(EAST.z, 0, -EAST.x);

/**
 * Direction to a body at the given hour angle (0 = due south at its
 * highest; negative = rising in the east) and declination, as seen from
 * LATITUDE, in world space.
 */
export function celestialDirection(
  hourAngle: number,
  declination: number,
  out: Vector3,
) {
  const cd = Math.cos(declination),
    sd = Math.sin(declination),
    cl = Math.cos(LATITUDE),
    sl = Math.sin(LATITUDE),
    ch = Math.cos(hourAngle);
  const east = -cd * Math.sin(hourAngle),
    north = cl * sd - sl * cd * ch,
    up = sl * sd + cl * cd * ch;
  return out
    .set(
      EAST.x * east + NORTH.x * north,
      up,
      EAST.z * east + NORTH.z * north,
    )
    .normalize();
}

/** Reused colors/uniform values: hour is authoritative, including in photo mode. */
export class EnvironmentLighting {
  readonly sunDirection = new Vector3();
  /** Direction to the moon; it lights the night instead of a mirrored sun. */
  readonly moonDirection = new Vector3();
  readonly lightDirection = new Vector3();
  /** Sun disc and glow tint: white-gold by day, deep orange at the horizon. */
  readonly sunTint = new Color();
  /** Lit fraction of the moon's disc (0 new, 1 full). */
  moonIllumination = 0;
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

  /** `day` counts whole game days; it advances the moon's phase and rise time. */
  update(hour: number, day = 0) {
    const hourAngle = ((hour - 12) / 24) * Math.PI * 2;
    celestialDirection(hourAngle, 0, this.sunDirection);
    const height = this.sunDirection.y;
    this.daylight = MathUtils.smoothstep(height, -0.18, 0.24);
    this.twilight =
      (1 - MathUtils.smoothstep(Math.abs(height), 0.04, 0.42)) *
      MathUtils.smoothstep(height, -0.25, -0.04);
    this.night = 1 - MathUtils.smoothstep(height, -0.08, 0.18);
    // The moon falls behind the sun by a growing angle each day.
    const elongation =
      MOON_START_ELONGATION + (Math.PI * 2 * (day + hour / 24)) / LUNAR_DAYS;
    celestialDirection(
      hourAngle - elongation,
      MOON_DECLINATION * Math.sin(elongation * 0.5 + 1),
      this.moonDirection,
    );
    this.moonIllumination = (1 - Math.cos(elongation)) / 2;
    const moonHeight = this.moonDirection.y;
    if (height > 0) this.lightDirection.copy(this.sunDirection);
    else if (moonHeight > 0) this.lightDirection.copy(this.moonDirection);
    else {
      // Nothing is up (intensity is 0); keep shadows pointing down from the sky.
      this.lightDirection.copy(this.moonDirection);
      this.lightDirection.y = 0.05;
      this.lightDirection.normalize();
    }
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
    // By night the moon lights the island according to its phase and height.
    this.sunIntensity =
      height > 0
        ? (0.55 + this.daylight * 2.45) * handoff
        : 0.55 *
          handoff *
          this.moonIllumination *
          MathUtils.smoothstep(moonHeight, 0.005, 0.07);
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
