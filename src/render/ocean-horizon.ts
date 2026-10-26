/** Visual curvature only: local water and collision remain at sea level. */
export const EARTH_RADIUS = 6_371_000;

export function oceanHorizon(height: number) {
  const altitude = Math.max(0, height);
  // Factored form avoids subtracting two almost equal squared radii.
  const distance = Math.sqrt(altitude * (2 * EARTH_RADIUS + altitude));
  return {
    distance,
    dip: distance / (EARTH_RADIUS + altitude),
    blendEnd: Math.max(200, Math.min(7000, distance * 0.45)),
  };
}

/** Shared linear colors keep the finite water mesh invisible at its far edge. */
import { AERIAL_FOG_START } from "./aerial-fog";
import { SKY_BODIES_GLSL } from "./sky-bodies";

export const OCEAN_BACKGROUND_GLSL = `
uniform vec3 sun,zenithColor,horizonColor,waterColor;
uniform float laserDim,horizonDip,oceanEnabled,oceanBlendEnd;
// Aerial haze matching AerialFog (0 density disables it, e.g. in Hell).
uniform float hazeDensity,hazeScale;
${SKY_BODIES_GLSL}
vec3 oceanBackground(vec3 d){
  vec3 sky=mix(zenithColor,horizonColor,pow(1.-max(d.y,0.),3.));
  // For a sphere tangent to local sea level, a ray hits water below -dip.
  float edge=d.y+horizonDip;
  float aa=max(fwidth(edge),.00002);
  float sea=oceanEnabled*(1.-smoothstep(-aa,aa,edge));
  // Sun, moon and stars only where sky shows (skipped for open water).
  if(sea<1.) sky=skyBodies(d,sky);
  float haze=exp(-max(-edge,0.)*80.);
  vec3 water=mix(waterColor*.8,horizonColor,haze*.72);
  if(hazeDensity>0.){
    // Same height-fog integral as scene fog, along the ray to a flat sea.
    float camY=max(cameraPosition.y,1.);
    float k=1./hazeScale;
    float seaDistance=camY/max(-d.y,1e-4);
    float optical=hazeDensity*(1.-exp(-camY*k))/(camY*k)
      *max(seaDistance-${AERIAL_FOG_START.toFixed(1)},0.);
    water=mix(water,horizonColor,1.-exp(-optical));
  }
  return mix(sky,water,sea)*(1.-laserDim);
}
`;
