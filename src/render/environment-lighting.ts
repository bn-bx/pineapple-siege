import { Color, MathUtils, Vector3 } from "three";

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
};

/** Reused colors/uniform values: hour is authoritative, including in photo mode. */
export class EnvironmentLighting {
  readonly sunDirection = new Vector3();
  readonly lightDirection = new Vector3();
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
    this.lightDirection.copy(this.sunDirection);
    if (height < 0) this.lightDirection.negate();
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
    this.sunIntensity = 0.55 + this.daylight * 2.45;
    this.ambientIntensity = 0.72 + this.daylight * 0.23;
  }
}

export const SKY_FRAGMENT = `
uniform vec3 sun,zenithColor,horizonColor;
uniform float laserDim;
varying vec3 vDirection;
void main(){
  vec3 d=normalize(vDirection);
  vec3 c=mix(zenithColor,horizonColor,pow(1.-max(d.y,0.),3.));
  float alignment=max(dot(d,sun.y>=0.?sun:-sun),0.);
  c+=vec3(.8,.75,.6)*smoothstep(.9999,.99998,alignment);
  gl_FragColor=vec4(c*(1.-laserDim),1.);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
