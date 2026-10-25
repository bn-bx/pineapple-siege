"""Bake an explicitly authored, reference-fitted polygon sculpt. Preview only.
Anatomical volumes and photo-fitted accessories are baked into real geometry.
Reference-derived UV textures are separate assets; depth is independently authored. The resulting XYZ mesh is ordinary 3D geometry.
"""
from pathlib import Path
import hashlib,json,math
from PIL import Image,ImageDraw
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'public/review/pineapple-god'
W,H=1145,1374
FOCAL=H/(2*math.tan(math.radians(45)/2))
parts=[]
materials={
 'gold':{'color':'#cf9e38','roughness':.82,'metalness':.08},
 'face':{'color':'#c99b3b','roughness':.86,'metalness':.06},
 'brow':{'color':'#b48828','roughness':.92,'metalness':0},
 'lipLight':{'color':'#d4a643','roughness':.9,'metalness':0},
 'fold':{'color':'#a57e32','roughness':1,'metalness':0},
 'eye':{'color':'#24271e','roughness':.5,'metalness':0},
 'nostril':{'color':'#68471d','roughness':1,'metalness':0},
 'lip':{'color':'#775021','roughness':.95,'metalness':0},
 'stone':{'color':'#989b89','roughness':.96,'metalness':0},
 'cloth':{'color':'#797c68','roughness':1,'metalness':0},
 'dark':{'color':'#343a28','roughness':.92,'metalness':0},
 'leaf':{'color':'#355024','roughness':1,'metalness':0},
 'leafGold':{'color':'#9b8229','roughness':.9,'metalness':0},
}
def xyz(p):
 x,y,z=p
 return [round((x-W/2)*(1800-z)/FOCAL,6),round(400+(H/2-y)*(1800-z)/FOCAL,6),z]
def add(name,vertices,faces,material='stone',region='body',face_materials=None):
 # Store source control vertices as provenance; renderer consumes only XYZ.
 parts.append({'id':name,'region':region,'damageOwner':name,'material':material,'vertices':[xyz(p) for p in vertices],
  'triangles':faces,'triangleMaterials':face_materials or [material]*len(faces)})
def cross(a,b,c):return (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])
def triangulate(points):
 # Ear clipping preserves a hand-authored concave contour.
 remaining=list(range(len(points)));result=[]
 area=sum(points[i][0]*points[(i+1)%len(points)][1]-points[(i+1)%len(points)][0]*points[i][1] for i in range(len(points)))
 sign=1 if area>0 else -1
 while len(remaining)>3:
  clipped=False
  for j in range(len(remaining)):
   ia,ib,ic=remaining[j-1],remaining[j],remaining[(j+1)%len(remaining)]
   a,b,c=points[ia],points[ib],points[ic]
   if cross(a,b,c)*sign<1e-5:continue
   def inside(p):return all(cross(u,v,p)*sign>=-1e-5 for u,v in [(a,b),(b,c),(c,a)])
   if any(inside(points[k]) for k in remaining if k not in (ia,ib,ic)):continue
   result.append([ia,ib,ic]);remaining.pop(j);clipped=True;break
  if not clipped:raise ValueError('Invalid authored contour')
 result.append(remaining);return result

def patch(name,outline,depth=130,peak=None,bulge=40,material='stone',region='body'):
 # Closed contour sculpt with successive curvature planes. The authored
 # contour fixes projection while depth rings retain volume in oblique views.
 n=len(outline);cx,cy=peak or (sum(p[0] for p in outline)/n,sum(p[1] for p in outline)/n)
 scales=[1,.88,.61,.3]
 v=[]
 for scale in scales:
  z=depth+bulge*math.sqrt(1-scale*scale)
  v.extend([[cx+(x-cx)*scale,cy+(y-cy)*scale,z] for x,y in outline])
 center=len(v);v.append([cx,cy,depth+bulge])
 back_start=len(v)
 v.extend([[cx+(x-cx)*.86,cy+(y-cy)*.86,depth-80] for x,y in outline])
 back=len(v);v.append([cx,cy,depth-110]);f=[]
 for ring in range(len(scales)-1):
  for i in range(n):
   j=(i+1)%n;a=ring*n+i;b=ring*n+j;c=(ring+1)*n+i;d=(ring+1)*n+j
   f.extend([[a,b,d],[a,d,c]])
 for i in range(n):
  j=(i+1)%n
  f.extend([[(len(scales)-1)*n+i,(len(scales)-1)*n+j,center],
   [i,back_start+i,back_start+j],[i,back_start+j,j],[back_start+i,back,back_start+j]])
 add(name,v,f,material,region)
 return outline

# One continuous head/neck asset, with UVs fixed in model space.
from head_sculpt import build_head
head_data=build_head(add)
parts[-1]['uv']=head_data['uv']
parts[-1]['projectionWeights']=head_data['projectionWeights']
parts[-1]['authorship']=head_data['authorship']
head_outline=head_data['headOutline']

# Continuous anatomical surfaces, with depth independent of source colors.
from body_sculpt import build_body,cloth,band,ellipsoid_mesh,stairs,CROP
build_body(add,parts)
cloth(add,parts)
band(add,'bracelet-left',(180,589,215),(.55,.83,0),51,50,32)
band(add,'bracelet-right',(906,717,177),(.22,.98,0),36,43,17)
band(add,'belt',(582,765,72),(0,1,0),153,98,14)

# Throne: solid authored architectural contours.
for side,x,y in [('left',214,742),('right',827,841)]:
 patch(f'throne-{side}-post',[(x,y+40),(x+101,y+40),(x+101,1057),(x+1,1057)],35,(x+26,(y+1081)/2),0,'stone','throne')
 patch(f'throne-{side}-arm',[(x-8,y),(x+151,y),(x+151,y+45),(x-8,y+45)],123,(x+45,y+13),0,'gold','throne')
patch('throne-back',[(294,520),(341,490),(802,490),(849,520),(849,1017),(294,1017)],-145,(574,721),0,'stone','throne')
# Shaft and head of the scepter.
shaft_v=[];shaft_f=[];shaft_n=16
for y in (341,1036):
 for i in range(shaft_n):
  a=i*2*math.pi/shaft_n;shaft_v.append([215+11*math.cos(a),y,229+11*math.sin(a)])
for j in range(shaft_n):
 k=(j+1)%shaft_n;shaft_f.extend([[j,k,k+shaft_n],[j,k+shaft_n,j+shaft_n]])
for ring,y in [(0,341),(shaft_n,1036)]:
 c=len(shaft_v);shaft_v.append([215,y,229])
 for j in range(shaft_n):shaft_f.append([ring+j,ring+(j+1)%shaft_n,c])
add('scepter-shaft',shaft_v,shaft_f,'gold','scepter')
# Low-poly pineapple on the staff, with authored ring widths baked as geometry.
def pineapple(name,cx,cy,rx,ry,depth,region='scepter'):
 rings=[];n=12
 for k in range(1,8):
  lat=-math.pi/2+k*math.pi/8;yy=cy-math.sin(lat)*ry;rr=math.cos(lat)
  rings.append([[cx+math.sin(a*math.pi*2/n)*rx*rr,yy,depth+math.cos(a*math.pi*2/n)*rx*rr] for a in range(n)])
 v=[[cx,cy+ry,depth]]+sum(rings,[])+[[cx,cy-ry,depth]];f=[]
 for i in range(n):f.append([0,1+(i+1)%n,1+i])
 for row in range(6):
  for i in range(n):
   a=1+row*n+i;b=1+row*n+(i+1)%n;c=a+n;d=b+n
   # A raised diamond center forms actual geometric rind facets.
   p=[sum(v[j][k] for j in [a,b,c,d])/4 for k in range(3)];p[2]+=10
   m=len(v);v.append(p);f.extend([[a,c,m],[c,d,m],[d,b,m],[b,a,m]])
 top=1+7*n
 for i in range(n):f.append([top,1+6*n+i,1+6*n+(i+1)%n])
 add(name,v,f,'gold',region)
pineapple('scepter-fruit',215,300,55,80,242)
# Crown leaves are explicitly positioned to match the visible fan.
def leaf(name,outline,depth,material='leaf',region='crown'):
 patch(name,outline,depth,None,9,material,region)
for i,(outline,depth,mat) in enumerate([
 ([(548,198),(524,161),(468,16),(516,80),(566,190)],-5,'leaf'),
 ([(551,193),(550,94),(545,1),(575,106),(578,193)],-25,'leaf'),
 ([(561,194),(597,92),(647,30),(608,150),(589,198)],-30,'leafGold'),
 ([(579,196),(615,159),(682,54),(638,163),(601,203)],5,'leaf'),
 ([(545,191),(512,161),(495,125),(548,165),(564,195)],30,'leafGold'),
 ([(576,194),(563,131),(571,65),(595,156),(595,197)],35,'leaf'),
 ([(590,199),(624,161),(654,112),(635,178),(603,204)],45,'leaf'),
]):leaf(f'crown-{i}',outline,depth,mat)
for i,outline in enumerate([
 [(204,225),(184,168),(212,208)],[(211,222),(210,148),(226,210)],[(220,224),(243,166),(233,221)],[(218,223),(232,185),(231,225)],[(200,225),(177,190),(212,225)],
]):leaf(f'scepter-leaf-{i}',outline,235+i*2,'leafGold' if i%2 else 'leaf','scepter')
# Necklace plates, pendant and its central dark inlay.
for i,(cx,cy,rx,ry) in enumerate([(393,461,28,8),(430,454,27,10),(470,460,30,11),(511,460,31,11),(554,469,31,11),(599,468,32,11),(640,460,31,12),(682,454,30,12),(725,460,29,10)]):
 outline=[(cx+math.cos(a*math.pi/4)*rx,cy+math.sin(a*math.pi/4)*ry) for a in range(8)]
 ellipsoid_mesh(add,f'necklace-{i}',(cx,cy,148),(rx,ry,16),'gold','jewelry')
patch('pendant',[(579,471),(611,507),(581,541),(550,506)],204,(581,506),7,'gold','jewelry')
patch('pendant-inlay',[(580,487),(596,507),(581,523),(565,506)],216,(580,506),1,'dark','jewelry')
patch('pendant-stem',[(574,538),(587,538),(586,598),(575,598)],195,(580,580),1,'gold','jewelry')

# Architecture is available for complete-scene review, but is excluded from the
# figure-only silhouette diagnostic so an enormous pedestal cannot hide errors.
patch('throne-plinth',[(267,1026),(852,1026),(879,1090),(234,1090)],70,(557,1058),0,'stone','throne')
stairs(add)

# The reference surface is fixed to each authored object's geometry.
for p in parts:
 if p['region'] in ('body','cloth','jewelry','scepter') and not p.get('uv'):
  x0,y0,x1,y1=CROP
  source=[(W/2+x*FOCAL/(1800-z),H/2-(y-400)*FOCAL/(1800-z),z) for x,y,z in p['vertices']]
  p['uv']=[[(x-x0)/(x1-x0),1-(y-y0)/(y1-y0)] for x,y,z in source]
  zmin=min(z for x,y,z in source);zmax=max(z for x,y,z in source);mid=(zmin+zmax)/2
  p['projectionWeights']=[max(0,min(1,(z-mid)/max(1,(zmax-zmin)*.3))) for x,y,z in source]
  p['surface']='body'

landmarks={
 'brow-left-outer':[538,271],'brow-left-inner':[582,274],
 'brow-right-inner':[612,275],'brow-right-outer':[652,278],
 'eye-left-outer':[538,290],'eye-left-inner':[582,291],
 'eye-right-inner':[614,293],'eye-right-outer':[653,294],
 'nose-bridge':[598,294],'nose-tip':[603,324],
 'mouth-left':[564,353],'mouth-center':[598,350],'mouth-right':[628,354],
 'chin':[598,410],'jaw-left':[545,398],'jaw-right':[646,399],
 'neck-left':[529,438],'neck-right':[649,438],
 'shoulder-left':[303,469],'shoulder-right':[823,478],
 'chest-left':[479,543],'chest-right':[690,543],
 'elbow-left':[310,705],'elbow-right':[916,660],
 'hand-left':[210,512],'hand-right':[915,787],
 'knee-left':[397,855],'knee-right':[751,856],
 'crown-top':[545,1],'scepter-top':[210,148],'scepter-bottom':[216,1036],
}
# Explicit masks. Annotations are human-authored estimates, not perfect segmentation.
mask=Image.new('L',(W,H));draw=ImageDraw.Draw(mask)
for p in parts:
 if p['region']=='throne':continue
 # Rasterize the authoring contours (project XYZ back with the locked camera).
 v=[(W/2+x*FOCAL/(1800-z),H/2-(y-400)*FOCAL/(1800-z)) for x,y,z in p['vertices']]
 for face in p['triangles']:draw.polygon([v[i] for i in face],fill=255)
# This is a separate hand-traced outer reference head boundary.
original=Image.open(OUT/'reference.png').convert('RGB')
import numpy as np
pixels=np.asarray(original)
r,g,b=[pixels[:,:,i].astype(float) for i in range(3)]
gold=(r>g*1.04)&(g>b*1.10)&(r>b*1.35)&(r>25)
gold[:190,:]=False;gold[415:,:]=False;gold[:,:465]=False;gold[:,681:]=False
headmask=Image.fromarray((gold*255).astype('uint8'))
from PIL import ImageFilter
headmask=headmask.filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.MinFilter(3))
# Flood fill the exterior; untouched black holes are the recessed eyes/mouth.
padded=Image.new('L',(W+2,H+2));padded.paste(headmask,(1,1))
ImageDraw.floodfill(padded,(0,0),127)
filled=np.asarray(padded)[1:-1,1:-1]
headmask=Image.fromarray(np.where(filled==127,0,255).astype('uint8'))
headmask.save(OUT/'reference-head-mask.png')
# Do not use the authored model's silhouette as the reference silhouette.
# Manual reference contours cover the visible figure; aircraft is excluded below.
# Freeze the existing reference trace. Do not regenerate it from revised meshes.
bodymask=Image.open(OUT/'reference-body-mask.png').convert('L')
valid=Image.new('L',(W,H),255);v=ImageDraw.Draw(valid)
plane=[(462,925),(540,910),(541,879),(545,851),(551,851),(562,892),(561,880),(573,868),(585,870),(595,884),(596,878),(601,849),(606,849),(610,880),(604,906),(714,915),(725,934),(615,935),(610,941),(672,947),(684,953),(668,967),(609,969),(606,979),(596,979),(594,969),(563,972),(554,980),(548,977),(482,980),(472,979),(463,966),(468,958),(523,945),(539,941),(539,937),(463,943)]
v.polygon(plane,fill=0);valid.save(OUT/'valid-mask.png')
annotations={'reference':'reference.png','size':[W,H],'headCrop':[463,184,684,480],
 'headOutline':head_outline,'headWidth':int(np.flatnonzero(np.any(np.asarray(headmask)>127,axis=0))[-1]-np.flatnonzero(np.any(np.asarray(headmask)>127,axis=0))[0]+1),'landmarks':landmarks,'unverifiedPolygons':[plane],
 'maskProvenance':'Head mask is segmented from original image colors and hole-filled. Body trace v2 is a source-coordinate manual estimate, corrected against the source pixel grid; the original coarse trace is retained. Some accessory contours remain shared authoring constraints. Body geometry is fitted to this trace; its overlap is a constraint-satisfaction check, not independent likeness proof. Neither score establishes exact appearance.',
 'thresholds':{'headIoU':.97,'bodyIoU':.95,'meanFaceErrorHeadWidths':.01,'maxFaceErrorHeadWidths':.02}}
(OUT/'annotations.json').write_text(json.dumps(annotations,indent=2)+'\n')
def orient(part):
 from collections import defaultdict,deque
 edges=defaultdict(list)
 faces=part['triangles']
 for i,f in enumerate(faces):
  for a,b in zip(f,f[1:]+f[:1]):edges[tuple(sorted((a,b)))].append((i,a<b))
 bad=[(edge,users) for edge,users in edges.items() if len(users)!=2]
 if bad:raise ValueError(f"{part['id']}: {len(bad)} nonmanifold edges")
 neighbors=defaultdict(list)
 for users in edges.values():
  (a,da),(b,db)=users;neighbors[a].append((b,da==db));neighbors[b].append((a,da==db))
 flips={}
 for start in range(len(faces)):
  if start in flips:continue
  flips[start]=False;queue=deque([start])
  while queue:
   a=queue.popleft()
   for b,different in neighbors[a]:
    expected=flips[a]^different
    if b in flips:
     if flips[b]!=expected:raise ValueError(f"{part['id']}: inconsistent winding")
    else:flips[b]=expected;queue.append(b)
 for i,flip in flips.items():
  if flip:faces[i]=list(reversed(faces[i]))
 v=part['vertices'];volume=0
 for a,b,c in faces:
  p,q,r=v[a],v[b],v[c]
  volume+=p[0]*(q[1]*r[2]-q[2]*r[1])+p[1]*(q[2]*r[0]-q[0]*r[2])+p[2]*(q[0]*r[1]-q[1]*r[0])
 if volume<0:part['triangles']=[list(reversed(f)) for f in faces]
for part in parts:orient(part)
# Bounds are derived from this same approved-candidate asset, not old primitive boxes.
for p in parts:
 p['bounds']={'min':[min(v[k] for v in p['vertices']) for k in range(3)],'max':[max(v[k] for v in p['vertices']) for k in range(3)]}
# Body iteration must not alter the already accepted head or its UV surface.
acceptance=json.loads((OUT/'visual-acceptance.json').read_text())
head=next(p for p in parts if p['id']=='head-neck-sculpt')
head_geometry_sha=hashlib.sha256(json.dumps(head,sort_keys=True).encode()).hexdigest()
head_surface_sha=hashlib.sha256((OUT/'head-surface.png').read_bytes()).hexdigest()
if head_geometry_sha!=acceptance['headGeometrySHA256'] or head_surface_sha!=acceptance['headSurfaceSHA256']:
 raise ValueError('Approved head changed during body revision')
asset={'schemaVersion':1,'meshRevision':hashlib.sha256(json.dumps(parts,sort_keys=True).encode()).hexdigest(),'status':'candidate-awaiting-visual-acceptance','units':'game-world-units',
 'camera':{'position':[0,400,1800],'target':[0,400,0],'fov':45,'near':1,'far':5000,'width':W,'height':H},
 'lighting':{'ambient':1.65,'sunIntensity':2.1,'sunPosition':[600,1200,1000],'fillIntensity':.4,'exposure':1,'time':0,'crt':'subtle'},
 'materials':materials,'parts':parts,'headApprovalPreserved':True,'revisionScope':'body-review',
 'clothProjection':{'texture':'cloth-surface.png','crop':list(CROP),'scope':'reconstructed hanging fabric','bakedLightingRemains':True},
 'bodyProjection':{'texture':'body-surface.png','crop':list(CROP),'scope':'body, drapery, jewelry and scepter','bakedLightingRemains':True,'occludedAreasReconstructed':True},
 'surfaceProjection':{'texture':'head-surface.png','crop':[460,184,705,478],'scope':'head and neck only','bakedLightingRemains':True},
 'notes':['The head uses a cleaned reference-derived UV texture on real geometry. Baked source shading remains; clay views are required to inspect anatomy.',
 'Depth and unseen surfaces are inferred from one image.','The live game does not import this candidate.']}
(OUT/'sculpt.json').write_text(json.dumps(asset,separators=(',',':'))+'\n')
reference=OUT/'reference.png'
(OUT/'reference-provenance.json').write_text(json.dumps({'filename':reference.name,'width':W,'height':H,'sha256':hashlib.sha256(reference.read_bytes()).hexdigest(),'modified':False},indent=2)+'\n')
annotated=Image.open(reference).convert('RGB');a=ImageDraw.Draw(annotated)
a.line(head_outline+[head_outline[0]],fill='#ffda60',width=2)
for name,(x,y) in landmarks.items():
 a.ellipse((x-3,y-3,x+3,y+3),fill='#ff4860');a.text((x+5,y-10),name,fill='white',stroke_width=1,stroke_fill='black')
a.line(plane+[plane[0]],fill='#66ffff',width=3)
annotated.save(OUT/'reference-annotated.png')
print(f'Authored {len(parts)} closed parts, {sum(len(p["triangles"]) for p in parts)} triangles. Live game unchanged.')
