"""Bake continuous anatomical volumes into watertight, UV-attached body meshes.
Reference x/y locate authored forms. Depth and unseen anatomy are reconstructed,
not inferred from image brightness. No runtime implicit geometry is evaluated.
"""
import math
import numpy as np
from pathlib import Path
from collections import deque
from PIL import Image

CROP=(130,140,980,1090)

def ellipsoid(center,radii,angle=0):
 c=np.array(center,dtype=np.float32);r=np.array(radii,dtype=np.float32)
 co,si=math.cos(angle),math.sin(angle)
 def distance(p):
  q=p-c;x=q[...,0]*co+q[...,1]*si;y=-q[...,0]*si+q[...,1]*co
  return (np.sqrt((x/r[0])**2+(y/r[1])**2+(q[...,2]/r[2])**2)-1)*min(r)
 return distance

def sweep(a,b,r0,r1=None):
 # A tapered round anatomical segment. Ellipsoidal muscle bellies are blended
 # into this armature, so an elbow/wrist never consists of disconnected plates.
 a=np.array(a,dtype=np.float32);b=np.array(b,dtype=np.float32);ab=b-a
 length2=np.dot(ab,ab);r1=r0 if r1 is None else r1
 def distance(p):
  q=p-a;t=np.clip(np.sum(q*ab,axis=-1)/length2,0,1)
  return np.linalg.norm(q-t[...,None]*ab,axis=-1)-(r0+(r1-r0)*t)
 return distance

def blend(functions,k=12):
 def distance(p):
  d=functions[0](p)
  for fn in functions[1:]:
   e=fn(p);h=np.clip(.5+.5*(e-d)/k,0,1)
   d=e*(1-h)+d*h-k*h*(1-h)
  return d
 return distance

def torso():
 sections=np.array([[465,584,135,65],[485,584,178,82],[520,584,208,92],
  [565,584,207,100],[610,592,200,96],[660,590,194,90],
  [710,588,173,83],[760,584,153,75],[784,582,130,58]],dtype=np.float32)
 def distance(p):
  y=p[...,1];cx=np.interp(y,sections[:,0],sections[:,1]);rx=np.interp(y,sections[:,0],sections[:,2]);rz=np.interp(y,sections[:,0],sections[:,3])
  d=(np.sqrt(((p[...,0]-cx)/rx)**2+((p[...,2]-20)/rz)**2)-1)*np.minimum(rx,rz)
  return np.maximum(d,np.maximum(465-y,y-784))
 return distance

def upper_field():
 f=[torso(),
  ellipsoid((477,547,103),(113,75,57)),ellipsoid((691,549,103),(112,76,57)),
  ellipsoid((582,696,95),(105,87,60)),
  ellipsoid((455,676,56),(49,91,70),-.12),ellipsoid((711,677,56),(48,92,70),.12),
  ellipsoid((333,532,48),(60,60,66),-.18),ellipsoid((821,532,48),(55,56,66),.18),
  sweep((347,553,58),(301,671,130),48,48),
  ellipsoid((339,618,112),(58,78,56),.28),
  sweep((260,684,150),(183,590,215),52,40),
  ellipsoid((220,657,176),(62,76,55),-.55),ellipsoid((247,630,183),(42,63,48),-.65),
  ellipsoid((279,681,128),(54,46,61)),
  sweep((836,558,54),(884,648,106),43,39),
  ellipsoid((866,612,96),(48,70,54),-.42),
  sweep((884,648,107),(913,744,193),38,27),
  ellipsoid((902,692,148),(42,58,48),-.22),
  # The palms continue the forearms. Fingers merge at the knuckles, retaining
  # distinct distal fingers and a wrapped left-hand grip around the staff.
  sweep((182,586,215),(199,546,225),38,40),
  ellipsoid((204,512,225),(58,68,40),-.12),
  sweep((197,466,245),(250,487,265),17,16),
  ellipsoid((916,782,209),(41,43,32),-.1),
  sweep((913,739,189),(914,778,210),26,29),
  sweep((875,760,226),(858,790,238),12,10),sweep((858,790,238),(861,812,231),10,8),
 ]
 for y in (649,697,742):
  for x in (537,624):f.append(ellipsoid((x,y,145),(43,29,18)))
 # Sternal and oblique furrows remain actual geometry, not separately floating abs.
 for i,(x,y) in enumerate(((177,502),(179,526),(190,548))):
  f += [sweep((x,y,253),(x+[67,61,41][i],y+6,270),14,13),ellipsoid((x+[42,36,25][i],y+3,271),(18,12,11))]
 for i,(x,end) in enumerate(((885,836),(905,844),(926,840),(945,830))):
  f += [sweep((x,784,226),(x-1,812,238),9,8),sweep((x-1,812,238),(x-3,end,226),8,7)]
 return blend(f,11)

def leg_field(side):
 if side=='left':
  f=[sweep((472,786,-30),(409,841,183),44,65),ellipsoid((397,857,191),(84,85,79),-.1),
   ellipsoid((386,912,236),(56,57,61)),sweep((378,938,245),(365,1032,253),48,46),
   ellipsoid((367,1006,253),(54,65,58))]
 else:
  f=[sweep((694,786,-30),(744,840,183),43,64),ellipsoid((751,858,191),(79,85,79),.1),
   ellipsoid((762,915,236),(52,57,61)),sweep((770,939,245),(780,1033,253),47,46),
   ellipsoid((777,1007,253),(53,66,58))]
 return blend(f,8)

# Consistent 0-to-6 tetrahedral decomposition on every voxel. Edge vertices are
# shared globally, so adjacent cubes cannot open cracks at their boundaries.
CORNERS=np.array([[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1]],dtype=int)
TETS=((0,5,1,6),(0,1,2,6),(0,2,3,6),(0,3,7,6),(0,7,4,6),(0,4,5,6))
def extract(field,bounds,step=5):
 axes=[np.arange(a+.137,b+step*.5,step,dtype=np.float32) for a,b in bounds]
 points=np.stack(np.meshgrid(*axes,indexing='ij'),axis=-1)
 values=field(points).astype(np.float32)
 if any(np.any(face<=0) for face in (values[0],values[-1],values[:,0],values[:,-1],values[:,:,0],values[:,:,-1])):
  raise ValueError('Sculpt exceeds extraction boundary')
 nx,ny,nz=values.shape
 corner_values=[values[dx:nx-1+dx,dy:ny-1+dy,dz:nz-1+dz] for dx,dy,dz in CORNERS]
 active=(np.minimum.reduce(corner_values)<0)&(np.maximum.reduce(corner_values)>=0)
 verts=[];faces=[];edges={};flat=values.ravel();origin=np.array([a[0] for a in axes])
 def vertex(a,b,pa,pb):
  key=(min(a,b),max(a,b))
  if key in edges:return edges[key]
  t=float(flat[a]/(flat[a]-flat[b]));p=pa+(pb-pa)*t
  index=len(verts);verts.append(p.tolist());edges[key]=index;return index
 for cell in np.argwhere(active):
  corners=cell+CORNERS
  ids=(corners[:,0]*ny+corners[:,1])*nz+corners[:,2]
  pos=origin+corners*step;sv=flat[ids]
  for tet in TETS:
   inside=[a for a in tet if sv[a]<0];outside=[a for a in tet if sv[a]>=0]
   if len(inside) in (0,4):continue
   def edge(a,b):return vertex(int(ids[a]),int(ids[b]),pos[a],pos[b])
   if len(inside)==1:
    a=inside[0];faces.append([edge(a,b) for b in outside])
   elif len(inside)==3:
    b=outside[0];faces.append([edge(a,b) for a in inside])
   else:
    a,b=inside;c,d=outside
    ac,ad,bc,bd=edge(a,c),edge(a,d),edge(b,c),edge(b,d)
    faces.extend([[ac,ad,bc],[ad,bd,bc]])
 vertices=np.array(verts)
 eps=.8
 grad=[]
 for axis in range(3):
  shift=np.zeros(3);shift[axis]=eps
  grad.append((field(vertices+shift)-field(vertices-shift))/(2*eps))
 grad=np.stack(grad,axis=1)
 normals=grad/np.maximum(np.linalg.norm(grad,axis=1,keepdims=True),1e-5)
 weights=np.clip((normals[:,2]-.08)*2.8,0,1)
 return verts,faces,weights.tolist(),normals

def attach_surface(part,vertices,weights):
 x0,y0,x1,y1=CROP
 part['uv']=[[(x-x0)/(x1-x0),1-(y-y0)/(y1-y0)] for x,y,z in vertices]
 part['projectionWeights']=weights
 part['surface']='body'

def fit_silhouette(vertices,normals,faces):
 # Bounded control-cage fitting against the independently drawn source trace.
 # This makes overlap a constraint-fit diagnostic, NOT independent proof of
 # anatomy. The front surface/relief and articulated fingers are not fitted.
 mask=np.asarray(Image.open(Path(__file__).resolve().parents[2]/'public/review/pineapple-god/reference-body-mask.png').convert('L'))>127
 h,w=mask.shape
 boundary=mask.copy()
 boundary[1:-1,1:-1] &= ~(mask[:-2,1:-1]&mask[2:,1:-1]&mask[1:-1,:-2]&mask[1:-1,2:])
 nearest_y=np.full((h,w),-1,dtype=np.int16);nearest_x=nearest_y.copy();distance=np.full((h,w),99,dtype=np.int16)
 queue=deque()
 for y,x in np.argwhere(boundary):nearest_y[y,x]=y;nearest_x[y,x]=x;distance[y,x]=0;queue.append((int(y),int(x)))
 while queue:
  y,x=queue.popleft()
  if distance[y,x]>=17:continue
  for yy,xx in ((y-1,x),(y+1,x),(y,x-1),(y,x+1)):
   if 0<=yy<h and 0<=xx<w and distance[yy,xx]>distance[y,x]+1:
    distance[yy,xx]=distance[y,x]+1;nearest_y[yy,xx]=nearest_y[y,x];nearest_x[yy,xx]=nearest_x[y,x];queue.append((yy,xx))
 p=np.asarray(vertices,dtype=float)
 x=np.clip(np.rint(p[:,0]).astype(int),0,w-1);y=np.clip(np.rint(p[:,1]).astype(int),0,h-1)
 weight=(1-np.abs(normals[:,2]))**4
 valid=(distance[y,x]<17)&~((p[:,0]<275)&(p[:,1]<590))&~((p[:,0]>845)&(p[:,1]>750))
 delta=np.stack([nearest_x[y,x]-p[:,0],nearest_y[y,x]-p[:,1]],axis=1)
 delta[~valid]=0
 lengths=np.linalg.norm(delta,axis=1)
 delta*=np.minimum(1,10/np.maximum(lengths,1e-6))[:,None]*weight[:,None]*.9
 # Diffuse control displacements over the connected cage. Raw per-vertex
 # nearest-pixel fitting creates visible ridges in oblique views, even while
 # improving the frontal score; smooth the displacement, not the anatomy.
 triangles=np.asarray(faces,dtype=int)
 edge=np.concatenate([triangles[:,[0,1]],triangles[:,[1,2]],triangles[:,[2,0]]])
 dest=np.concatenate([edge[:,0],edge[:,1]]);src=np.concatenate([edge[:,1],edge[:,0]])
 count=np.maximum(np.bincount(dest,minlength=len(p)),1)
 for _ in range(14):
  average=np.stack([np.bincount(dest,weights=delta[src,axis],minlength=len(p))/count for axis in range(2)],axis=1)
  delta=delta*.25+average*.75
 p[:,:2]+=delta
 return p.tolist(),{'method':'Bounded silhouette control-cage fit; constraint satisfaction is not independent anatomy evidence.','maxPixelShift':float(np.max(np.linalg.norm(delta,axis=1))),'meanPixelShift':float(np.mean(np.linalg.norm(delta,axis=1)))}

def build_body(add,parts):
 for name,field,bounds in [
  ('body-upper-sculpt',upper_field(),((135,985),(430,870),(-140,320))),
  ('body-left-leg-sculpt',leg_field('left'),((275,550),(705,1100),(-110,380))),
  ('body-right-leg-sculpt',leg_field('right'),((615,870),(705,1100),(-110,380))),
 ]:
  v,f,w,normals=extract(field,bounds)
  v,fit=fit_silhouette(v,normals,f)
  add(name,v,f,'stone','body');attach_surface(parts[-1],v,w)
  parts[-1]['silhouetteFit']=fit
  parts[-1]['authorship']='Blended anatomical volumes baked as one closed connected surface; depth inferred from one photograph.'
  print(name,len(v),'vertices',len(f),'triangles',flush=True)


def cloth(add,parts):
 v=[];f=[];w=[];n=96;ys=list(range(772,1063,10))+[1068]
 for y in ys:
  t=(y-772)/(1068-772);rx=151-27*t
  for i in range(n):
   a=-math.pi/2+i*2*math.pi/n
   pleat=6*math.cos(a*12)*(1-.3*t)
   x=582-8*t+math.sin(a)*(rx+pleat*.3)
   z=45+math.cos(a)*(88+pleat)
   v.append([x,y,z]);w.append(max(0,min(1,(math.cos(a)-.1)*3)))
 for k in range(len(ys)-1):
  for j in range(n):
   a=k*n+j;b=k*n+(j+1)%n;c=a+n;d=b+n;f.extend([[a,c,d],[a,d,b]])
 for k in (0,len(ys)-1):
  c=len(v);v.append([582,ys[k],45]);w.append(0)
  for j in range(n):f.append([k*n+j,k*n+(j+1)%n,c])
 add('cloth-drapery',v,f,'cloth','cloth');attach_surface(parts[-1],v,w);parts[-1]['surface']='cloth'


def band(add,name,center,axis,radius,depth_radius,length,material='gold',region='jewelry'):
 axis=np.array(axis,dtype=float);axis/=np.linalg.norm(axis)
 side=np.array([axis[1],-axis[0],0.]);side/=np.linalg.norm(side)
 zaxis=np.cross(axis,side);center=np.array(center,dtype=float)
 v=[];f=[];n=48
 # Four rings form an actual closed metal sleeve, not a beveled front plate.
 for along,inset in ((-length/2,0),(length/2,0),(length/2,4),(-length/2,4)):
  for j in range(n):
   a=j*2*math.pi/n
   p=center+axis*along+side*((radius-inset)*math.cos(a))+zaxis*((depth_radius-inset)*math.sin(a))
   v.append(p.tolist())
 for k in range(4):
  for j in range(n):
   a=k*n+j;b=k*n+(j+1)%n;c=((k+1)%4)*n+j;d=((k+1)%4)*n+(j+1)%n
   f.extend([[a,c,d],[a,d,b]])
 add(name,v,f,material,region)


def ellipsoid_mesh(add,name,c,r,material='gold',region='jewelry'):
 v=[];f=[];n=20;m=10
 # Poles are single shared vertices so every edge has exactly two faces.
 v.append([c[0],c[1]-r[1],c[2]])
 for k in range(1,m):
  p=-math.pi/2+k*math.pi/m
  for j in range(n):
   a=j*2*math.pi/n;v.append([c[0]+r[0]*math.cos(p)*math.sin(a),c[1]+r[1]*math.sin(p),c[2]+r[2]*math.cos(p)*math.cos(a)])
 top=len(v);v.append([c[0],c[1]+r[1],c[2]])
 for j in range(n):f.extend([[0,1+j,1+(j+1)%n],[top,1+(m-2)*n+j,1+(m-2)*n+(j+1)%n]])
 for k in range(m-2):
  for j in range(n):
   a=1+k*n+j;b=1+k*n+(j+1)%n;f.extend([[a,b,b+n],[a,b+n,a+n]])
 add(name,v,f,material,region)


def stairs(add):
 # Horizontal treads and vertical risers share a closed solid. Source framing
 # fixes the rail widths; actual tread depth is solved from the camera model.
 def left_inner(y):return 398-(y-1040)*.19
 def left_outer(y):return 344-(y-1040)*.274
 def right_inner(y):return 738+(y-1040)*.13
 def right_outer(y):return 784+(y-1040)*.215
 profile=[(1038,340),(1063,340)]
 z=340
 for i in range(24):
  y0=1063+i*(311/24);y1=1063+(i+1)*(311/24);yt=y0+(y1-y0)*.67
  z=1800-(687-y0)*(1800-z)/(687-yt)
  profile.extend([(yt,z),(y1,z)])
 for name,lo,hi,mat in [('stairs',left_inner,right_inner,'stone'),('stair-rail-left',left_outer,left_inner,'gold'),('stair-rail-right',right_inner,right_outer,'gold')]:
  v=[];f=[]
  for y,z in profile:v.extend([[lo(y),y,z],[hi(y),y,z]])
  for j in range(len(profile)-1):
   a=j*2;b=a+1;c=a+2;d=a+3;f.extend([[a,c,d],[a,d,b]])
  boundary=[j*2 for j in range(len(profile))]+[j*2+1 for j in reversed(range(len(profile)))]
  back=len(v)
  for i in boundary:
   x,y,z=v[i];v.append([x,y,z-70])
  center=len(v);v.append([sum(v[i][0] for i in boundary)/len(boundary),sum(v[i][1] for i in boundary)/len(boundary),100])
  for j,a in enumerate(boundary):
   k=(j+1)%len(boundary);b=boundary[k]
   f.extend([[a,b,back+k],[a,back+k,back+j],[back+j,back+k,center]])
  add(name,v,f,mat,'throne')
