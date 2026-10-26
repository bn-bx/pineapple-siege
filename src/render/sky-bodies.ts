/**
 * Sun, moon and stars for the sky (and the sky-drawn ocean backdrop).
 *
 * - Sun: a bright disc with limb darkening and a two-lobe glow; the tint
 *   warms toward orange as the sun nears the horizon and the glow widens.
 * - Moon: its own direction (see MOON_AZIMUTH_OFFSET), lit by the sun so it
 *   shows a phase, with soft maria mottling, faint earthshine and a halo.
 * - Stars: sparse hashed points that fade in with darkness and near the
 *   horizon, with gentle twinkle.
 *
 * Values are linear HDR; the output pass tone-maps the disc to white-gold.
 */
/** Angular radii (radians). Real values are ~0.0046; enlarged for readability. */
export const SUN_RADIUS = 0.014;
export const MOON_RADIUS = 0.02;

export const SKY_BODIES_GLSL = /* glsl */ `
uniform vec3 moon, sunTint;
uniform float starStrength, skyTime;
float skyHash(vec3 p){ p=fract(p*vec3(443.897,441.423,437.195)); p+=dot(p,p.yzx+19.19); return fract((p.x+p.y)*p.z); }
float skyNoise(vec2 p){
  vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  float a=skyHash(vec3(i,1.)), b=skyHash(vec3(i+vec2(1,0),1.)), c=skyHash(vec3(i+vec2(0,1),1.)), d=skyHash(vec3(i+1.,1.));
  return mix(mix(a,b,f.x),mix(c,d,f.x),f.y);
}
// Angle (radians) between unit vectors, stable near zero.
float skyAngle(vec3 a, vec3 b){ return 2.*asin(clamp(length(a-b)*.5,0.,1.)); }
// Takes the sky colour behind and returns it with the bodies drawn in.
vec3 skyBodies(vec3 d, vec3 sky){
  vec3 c=vec3(0.);
  // Angular size of one pixel, taken outside any branch (derivatives inside
  // divergent branches are undefined).
  float px=max(length(fwidth(d)),1e-5);
  // Sun.
  float ts=skyAngle(d,sun);
  float aa=px;
  float sunUp=smoothstep(-.06,.0,sun.y);
  float disc=1.-smoothstep(${SUN_RADIUS.toFixed(4)}-aa,${SUN_RADIUS.toFixed(4)}+aa,ts);
  float r=clamp(ts/${SUN_RADIUS.toFixed(4)},0.,1.);
  float limb=.55+.45*sqrt(1.-r*r);
  float low=1.-smoothstep(.02,.35,sun.y);
  // The disc covers the sky rather than adding to it, and is dimmer near the
  // horizon so its orange doesn't clip to white.
  vec3 sunDisc=sunTint*limb*mix(18.,4.5,low);
  float glow=.5*exp(-ts*(26.-14.*low))+.14*exp(-ts*(5.-2.5*low));
  c+=sunTint*glow*(1.+2.2*low)*sunUp;
  // Low sun: a broad warm band along the horizon on the sun's side.
  c+=sunTint*low*.35*exp(-abs(d.y)*9.)*pow(max(dot(normalize(d.xz+1e-5),normalize(sun.xz+1e-5)),0.),3.)*sunUp;
  // Moon.
  float tm=skyAngle(d,moon);
  float moonUp=smoothstep(-.04,.02,moon.y);
  if(tm<${(MOON_RADIUS * 1.6).toFixed(4)}){
    vec3 right=normalize(cross(moon,abs(moon.y)<.99?vec3(0.,1.,0.):vec3(1.,0.,0.)));
    vec3 up=cross(right,moon);
    vec2 p=vec2(dot(d-moon,right),dot(d-moon,up))/${MOON_RADIUS.toFixed(4)};
    float rr=dot(p,p);
    float aam=px/${MOON_RADIUS.toFixed(4)};
    float mdisc=1.-smoothstep(1.-aam,1.+aam,sqrt(rr));
    // The visible hemisphere faces the viewer (-moon), so a moon opposite
    // the sun is full and one near the sun is a thin crescent.
    vec3 n=normalize(right*p.x+up*p.y-moon*sqrt(max(1.-rr,0.)));
    float lit=smoothstep(-.04,.12,dot(n,sun));
    float maria=.5+.5*smoothstep(.3,.7,skyNoise(p*1.6+7.)*.65+skyNoise(p*3.9-3.)*.35);
    float craters=.92+.08*skyNoise(p*11.);
    // Bright enough to read as the moon, dim enough that its markings survive.
    vec3 moonColor=vec3(.8,.84,.92)*maria*maria*craters*(lit*.62+.03);
    sky=mix(sky,moonColor,mdisc*moonUp);
  }
  c+=vec3(.45,.55,.8)*(.1*exp(-tm*24.)+.03*exp(-tm*6.))*moonUp*starStrength;
  // Stars (only on clear, dark sky; the ocean backdrop never asks for them).
  if(starStrength>.001&&d.y>0.){
    vec3 q=d*220.;
    vec3 cell=floor(q);
    float h=skyHash(cell);
    if(h>.992){
      vec3 star=cell+.5+.35*(vec3(skyHash(cell+1.7),skyHash(cell+3.1),skyHash(cell+5.3))-.5);
      float dist=length(q-star);
      float size=.05+.07*fract(h*97.);
      float aas=max(px*220.,1e-4);
      float twinkle=.75+.25*sin(skyTime*(1.5+h*3.)+h*40.);
      // Mostly faint stars with a few bright ones.
      float bright=pow(fract(h*313.),6.)*2.4+.12;
      c+=vec3(.85,.9,1.)*(1.-smoothstep(size-aas,size+aas,dist))*bright*twinkle
        *starStrength*smoothstep(0.,.18,d.y);
    }
  }
  sky=mix(sky,sunDisc,disc*sunUp);
  return sky+c;
}
`;
