/** Continuous world-space noise shared by shallow water and breaking surf. */
export const COASTAL_NOISE_GLSL = `
float coastHash(vec2 p){vec3 q=fract(vec3(p.xyx)*.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
float coastNoise(vec2 p){
  vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
  return mix(mix(coastHash(i),coastHash(i+vec2(1.,0.)),f.x),
    mix(coastHash(i+vec2(0.,1.)),coastHash(i+vec2(1.)),f.x),f.y);
}
float coastFbm(vec2 p){return coastNoise(p)*.57+coastNoise(p*2.07+19.)*.28+coastNoise(p*4.13+43.)*.15;}
`;
