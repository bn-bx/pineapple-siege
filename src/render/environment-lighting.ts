import { Color, Vector3, MathUtils } from "three";

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
  cloudDay: new Color("#fff5df"),
  cloudSet: new Color("#ffc092"),
  cloudNight: new Color("#3c4d6a"),
  waterDay: new Color("#126b88"),
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
  readonly cloudColor = new Color();
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
    this.cloudColor
      .lerpColors(palette.cloudNight, palette.cloudDay, this.daylight)
      .lerp(palette.cloudSet, this.twilight);
    this.waterColor
      .lerpColors(palette.waterNight, palette.waterDay, this.daylight)
      .lerp(palette.waterSet, this.twilight * 0.65);
    this.sunIntensity = 0.55 + this.daylight * 2.45;
    this.ambientIntensity = 0.8 + this.daylight * 1.08;
  }
}

export const SKY_FRAGMENT = `
uniform vec3 sun,zenithColor,horizonColor,cloudColor;
uniform float day,time,laserDim,twilight,discoAmount;
varying vec3 vDirection;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+1.),f.x),f.y);}
void main(){
  vec3 d=normalize(vDirection);
  float h=pow(1.-max(d.y,0.),3.);
  float facing=max(dot(d.xz,sun.xz)/max(length(d.xz)*length(sun.xz),.001),0.);
  vec3 c=mix(zenithColor,horizonColor,h);
  c+=twilight*pow(facing,4.)*h*vec3(.22,.045,.025);
  c+=twilight*(1.-facing)*h*vec3(.065,.025,.09);
  float cloud=0.;
  if(d.y>.03){
    vec2 p=d.xz/d.y*1.1+time*.002;
    float n=noise(p*2.)*.6+noise(p*4.1+13.)*.28+noise(p*8.3)*.12;
    cloud=smoothstep(.50,.69,n)*smoothstep(.03,.18,d.y);
    vec3 shade=mix(zenithColor*.6,cloudColor,smoothstep(.50,.77,n));
    shade+=twilight*facing*vec3(.16,.025,.008);
    c=mix(c,shade,cloud*.9);
  }
  float alignment=max(dot(d,sun),0.);
  float sunVisible=smoothstep(-.1,.015,sun.y);
  c+=vec3(1.,.48,.18)*pow(alignment,32.)*twilight*.18;
  c+=vec3(1.,.77,.37)*pow(alignment,1500.)*sunVisible;
  c+=vec3(.7,.8,1.)*pow(max(dot(d,-sun),0.),1800.)*(1.-day);
  float stars=step(.9985,hash(floor(d.xz/(abs(d.y)+.2)*600.)))*max(d.y,0.);
  c+=stars*(1.-day)*(1.-cloud);
  gl_FragColor=vec4(mix(c*(1.-laserDim),vec3(.001,.001,.003),discoAmount),1.);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
