"""Prepare body UV detail. Preserve the source; explicitly reconstruct the area
covered by the aircraft rather than baking the aircraft onto the statue."""
from pathlib import Path
from collections import deque
import json,hashlib
import numpy as np
from PIL import Image,ImageFilter
P=Path(__file__).resolve().parents[2]/'public/review/pineapple-god'
source=Image.open(P/'reference.png').convert('RGB');raw=np.asarray(source,dtype=float)/255
x0,y0,x1,y1=130,140,980,1090
# Suppress screenshot scanlines using neighboring background row modulation.
sky=np.median(raw[y0:y1,1050:1130].mean(axis=2),axis=1)
pad=np.pad(sky,(5,5),mode='edge');trend=np.array([np.median(pad[i:i+11]) for i in range(len(sky))])
ratio=np.clip(trend/np.maximum(sky,.04),.88,1.14)
clean=np.clip(raw[y0:y1,x0:x1]*ratio[:,None,None],0,1)
trace=np.asarray(Image.open(P/'reference-body-mask.png').convert('L'))[y0:y1,x0:x1]>127
occluded=np.asarray(Image.open(P/'valid-mask.png').convert('L'))[y0:y1,x0:x1]<128
# Extend the occlusion by four pixels to exclude aircraft edge antialiasing.
occluded=np.asarray(Image.fromarray(np.uint8(occluded*255)).filter(ImageFilter.MaxFilter(9)))>127
r,g,b=clean[:,:,0],clean[:,:,1],clean[:,:,2]
stone=(r>g*.91)&(g>b*.96)&(r>b*.98)
gold=(r>g*1.04)&(g>b*1.1)&(r>b*1.35)
valid=trace&(stone|gold)&~occluded
# Inferred cloth pattern uses an unoccluded lower cloth strip at the same x.
# This region is explicitly excluded from likeness measurements and not claimed
# as recovered source anatomy. No aircraft pixels survive in the UV atlas.
for yy,xx in np.argwhere(occluded):
 source_y=1000+(yy+y0)%20
 clean[yy,xx]=raw[source_y,xx+x0]
 valid[yy,xx]=True
# Conservative illumination correction, with no attempt to claim true albedo.
luma=clean@np.array([.2126,.7152,.0722])
mask=valid.astype(float)
def blur(a):return np.asarray(Image.fromarray(np.uint8(np.clip(a,0,1)*255)).filter(ImageFilter.GaussianBlur(30)),dtype=float)/255
field=blur(luma*mask)/np.maximum(blur(mask),.05)
median=np.median(luma[valid&~occluded])
correction=np.clip((median/np.maximum(field,.05))**.18,.9,1.10)
clean=np.clip(clean*correction[:,:,None],0,1)
# Color gutters prevent background sky/water from smearing onto side surfaces.
queue=deque(map(tuple,np.argwhere(valid)));filled=valid.copy()
while queue:
 y,x=queue.popleft()
 for yy,xx in ((y-1,x),(y+1,x),(y,x-1),(y,x+1)):
  if 0<=yy<valid.shape[0] and 0<=xx<valid.shape[1] and not filled[yy,xx]:
   clean[yy,xx]=clean[y,x];filled[yy,xx]=True;queue.append((yy,xx))
# A separate cloth atlas reconstructs a continuous vertical fabric pattern.
# It uses the unoccluded upper cloth strip, never aircraft-shaped cut-and-fill
# patches. Only the garment uses this atlas; leg/arm anatomy keeps its own map.
cloth=clean.copy()
for xx in range(clean.shape[1]):
 source_x=max(465,min(700,xx+x0))
 color=np.median(raw[795:830,source_x],axis=0)
 cloth[:,xx]=color
Image.fromarray(np.uint8(np.clip(cloth,0,1)*255)).save(P/'cloth-surface.png')
Image.fromarray(np.uint8(clean*255)).save(P/'body-surface.png')
(P/'body-surface-provenance.json').write_text(json.dumps({
 'source':'reference.png','sourceSHA256':hashlib.sha256((P/'reference.png').read_bytes()).hexdigest(),
 'texture':'body-surface.png','crop':[x0,y0,x1,y1],
 'geometry':'Authored anatomical volumes, not photograph-derived depth',
 'processing':['Conservative scanline compensation','Broad illumination correction limited to 10%','Color gutters beyond source silhouette'],
 'occlusion':'Aircraft mask expanded four pixels. A separate continuous cloth atlas uses an unoccluded upper fabric strip; hidden fabric is reconstructed, not verified.',
 'limitations':['Baked photographed shading remains. This is not recovered true albedo.','Side and rear anatomy is reconstructed.','Source-driven appearance measurements do not independently validate geometry.'],
 'sourceModified':False,'cameraFacingBillboard':False},indent=2)+'\n')
print('Body surface prepared; foreground aircraft removed from inferred cloth region.')
