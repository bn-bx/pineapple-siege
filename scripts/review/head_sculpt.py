"""Connected head/neck control surface, baked into ordinary polygon geometry."""
import math
# Outer skull trace also serves as an independently reviewable silhouette annotation.
left_profile=[(190,572),(194,550),(200,536),(210,521),(220,510),(230,504),(250,493),(275,481),(300,474),(330,474),(350,474),(375,482),(390,485),(400,489),(410,492),(415,492)]
right_profile=[(190,625),(194,621),(200,619),(210,633),(220,643),(230,650),(250,659),(275,664),(300,669),(330,667),(350,667),(375,663),(390,659),(400,655),(410,655),(415,656)]
right_profile=[(y,x+(2 if y>=230 else 0)) for y,x in right_profile]
def interp(y,profile):
 for (a,x),(b,z) in zip(profile,profile[1:]):
  if y<=b:return x+(z-x)*max(0,min(1,(y-a)/(b-a)))
 return profile[-1][1]


def build_head(add):
 # The old detached brow/nose plates are gone. These feature boundaries belong
 # to one closed front/skull/neck surface with a rounded rear cranium.
 ys=[190,194,200,206,212,218,224,230,237,244,251,258,264,268,272,276,280,284,288,292,296,300,305,310,315,319,323,327,331,335,339,343,347,351,355,359,363,368,374,380,386,392,398,404,410,415,420,426,432,438,444,450,456,462,468,474]
 left=left_profile+[(420,492),(430,494),(440,489),(450,481),(460,486),(474,523)]
 right=right_profile+[(420,658),(430,661),(440,667),(450,682),(460,694),(474,661)]
 # Anatomical relief controls are authored independently of photograph
 # brightness. Broad facial planes share one surface; localized volumes carve
 # sockets and cheek hollows without extruding entire horizontal rows.
 features=[
  ('forehead',594,251,62,26,9),
  ('left-brow',560,275,29,4.2,20),('right-brow',635,277,27,4.2,20),
  ('left-orbit',560,290,23,6,-17),('right-orbit',635,292,22,6,-17),
  ('nasal-bridge',597,303,7,25,25),('nasal-tip',602,323,10,6,31),
  ('alar-left',589,322,6,4,15),('alar-right',612,323,6,4,13),
  ('left-cheekbone',551,315,19,11,19),('right-cheekbone',642,318,17,11,17),
  ('left-cheek-hollow',547,345,15,20,-15),('right-cheek-hollow',645,346,13,19,-12),
  ('mouth-mound',598,350,31,16,5),('upper-lip',598,346,23,3,9),
  ('left-mouth-corner',567,352,4,4,-4),('right-mouth-corner',627,353,4,4,-4),
  ('lip-seam',598,353,25,1.7,-6),('lower-lip',598,360,21,4,11),
  ('chin-fold',598,372,25,4,-7),('chin',598,391,35,15,22),
  ('left-jaw',555,388,17,17,12),('right-jaw',638,389,16,16,10),
 ]
 def face_depth(x,y):
  z=113
  for name,cx,cy,rx,ry,depth in features:
   d=((x-cx)/rx)**2+((y-cy)/ry)**2
   z+=depth*math.exp(-d*1.4)
  # Angular human planes: small broad cheek/chin plateaus, bounded in both
  # axes. They do not continue around the sides as horizontal shelves.
  return z
 # Dense sampling is baked, not evaluated at runtime. More cross sections
 # avoid turning narrow brow/nose features into horizontal ledges.
 ys=sorted(set(ys+list(range(192,474,2))))
 left_face=[(190,565),(230,525),(265,526),(300,525),(335,537),(375,546),(415,554)]
 right_face=[(190,628),(230,650),(265,658),(300,665),(335,661),(375,652),(415,642)]
 n=112;vertices=[];uv=[];weights=[];rings=[]
 for y in ys:
  lo,hi=interp(y,left),interp(y,right);cx=(lo+hi)/2;rx=(hi-lo)/2
  ring=[]
  for j in range(n):
   theta=-math.pi/2+j*2*math.pi/n
   # Front: theta -pi/2..pi/2; rear: the remainder of the same ring.
   nx=math.sin(theta);x=cx+rx*nx;front=math.cos(theta)>=-1e-7
   rear_radius=interp(y,[(190,12),(200,30),(220,60),(250,85),(290,95),(330,90),(370,72),(400,58),(415,46),(430,45),(450,52),(474,60)])
   z=-32+math.cos(theta)*(155 if front else rear_radius)
   if front:
    if y<=415:
     base=face_depth(x,y)
     # Blend into the curved skull at the sides, preserving the facial planes.
     left_bound=interp(y,left_face);right_bound=interp(y,right_face)
     if x<left_bound: w=max(0,min(1,(x-lo)/max(1,left_bound-lo)))
     elif x>right_bound:w=max(0,min(1,(hi-x)/max(1,hi-right_bound)))
     else:w=1
     w=w*w*(3-2*w)
     z=z*(1-w)+base*w
     rind=(y<264 or x<interp(y,[(190,560),(264,533),(320,536),(370,548),(415,554)]) or x>interp(y,[(190,630),(264,657),(320,655),(370,649),(415,642)]))
     if rind:
      # Small actual relief under the photographic facets; no stacked plates.
      course=y/13;xx=(x+(int(course)%2)*7)/14
      relief=max(0,1-abs((xx%1)-.5)*2-abs((course%1)-.5)*2)
      z+=relief*6*max(0,math.cos(theta))
    else:
     # Jaw narrows into a genuine neck cross section; tendon ridges continue
     # into the trapezius rather than sitting on detached beveled patches.
     neck=110+18*math.exp(-((x-551)/9)**2)+15*math.exp(-((x-639)/10)**2)-20*math.exp(-((x-592)/16)**2)
     z=-32+(neck+32)*max(0,math.cos(theta))
   else:
    z-=2*math.sin(j*.4+y*.15)**2*abs(math.cos(theta))
   ring.append(len(vertices));vertices.append([x,y,z])
   uv.append([(x-460)/245,1-(y-184)/294])
   # A UV-attached projection on the front surface, fading before the unseen
   # rear. It does not face the viewer or move when the camera rotates.
   weights.append(max(0,min(1,(math.cos(theta)-.15)*3)))
  rings.append(ring)
 faces=[]
 for i in range(len(rings)-1):
  for j in range(n):
   a=rings[i][j];b=rings[i][(j+1)%n];c=rings[i+1][j];d=rings[i+1][(j+1)%n]
   faces.extend([[a,c,d],[a,d,b]])
 for ring,y in [(rings[0],ys[0]),(rings[-1],ys[-1])]:
  center=len(vertices);vertices.append([(interp(y,left)+interp(y,right))/2,y,-32]);uv.append([.5,.5]);weights.append(0)
  for j in range(n):faces.append([ring[j],ring[(j+1)%n],center])
 add('head-neck-sculpt',vertices,faces,'face','head')
 # The authoring caller adds UV and weighting channels after XYZ conversion.
 return {'uv':uv,'projectionWeights':weights,'sourceCrop':[460,184,705,478],
   'headOutline':[[interp(y,left_profile),y] for y in [194,210,230,250,275,300,330,350,375,395,413]]+[[interp(y,right_profile),y] for y in [413,395,375,350,330,300,275,250,230,210,194]],
   'authorship':'A single closed head/skull/neck mesh baked from authored anatomical relief controls; no photograph-derived depth. Rear depth inferred.'}
