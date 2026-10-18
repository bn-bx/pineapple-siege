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
export const OCEAN_BACKGROUND_GLSL = `
uniform vec3 sun,zenithColor,horizonColor,waterColor;
uniform float laserDim,horizonDip,oceanEnabled,oceanBlendEnd;
vec3 oceanBackground(vec3 d){
  vec3 sky=mix(zenithColor,horizonColor,pow(1.-max(d.y,0.),3.));
  float alignment=max(dot(d,sun.y>=0.?sun:-sun),0.);
  sky+=vec3(.8,.75,.6)*smoothstep(.9999,.99998,alignment);
  // For a sphere tangent to local sea level, a ray hits water below -dip.
  float edge=d.y+horizonDip;
  float aa=max(fwidth(edge),.00002);
  float sea=oceanEnabled*(1.-smoothstep(-aa,aa,edge));
  float haze=exp(-max(-edge,0.)*80.);
  vec3 water=mix(waterColor*.8,horizonColor,haze*.72);
  return mix(sky,water,sea)*(1.-laserDim);
}
`;
