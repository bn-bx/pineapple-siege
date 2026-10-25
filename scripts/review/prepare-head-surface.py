"""Prepare a reference-derived material, preserving the supplied source unchanged.
Remove the measurable horizontal display modulation using adjacent sky, then
reduce only broad illumination. This is NOT a recovered true albedo: feature
shadows remain and are disclosed in the preview and provenance.
"""
from pathlib import Path
import json,hashlib
import numpy as np
from PIL import Image,ImageFilter
P=Path(__file__).resolve().parents[2]/'public/review/pineapple-god'
source=Image.open(P/'reference.png').convert('RGB')
a=np.asarray(source,dtype=float)/255
# The unobstructed sky shares the screenshot's scanline modulation. Its broad
# gradient is retained; only high-frequency row changes are compensated.
sky=np.median(a[174:488,1010:1110].mean(axis=2),axis=1)
pad=np.pad(sky,(5,5),mode='edge')
trend=np.array([np.median(pad[i:i+11]) for i in range(len(sky))])
ratio=np.clip(trend/np.maximum(sky,.05),.83,1.2)
a[174:488]*=ratio[:,None,None]
box=(460,184,705,478)
clean=np.clip(a[184:478,460:705],0,1)
# Weighted broad illumination estimate ignores sky and recessed eyes.
r,g,b=clean[:,:,0],clean[:,:,1],clean[:,:,2]
gold=((r>g*1.08)&(g>b*1.25)&(r>.28)).astype(float)
luma=clean@np.array([.2126,.7152,.0722])
def blur(values):
 return np.asarray(Image.fromarray(np.uint8(np.clip(values,0,1)*255)).filter(ImageFilter.GaussianBlur(20)),dtype=float)/255
field=blur(luma*gold)/np.maximum(blur(gold),.05)
median=np.median(luma[gold>0])
correction=np.clip((median/np.maximum(field,.05))**.32,.85,1.16)
albedo=np.clip(clean*correction[:,:,None],0,1)
# Extend valid head colors outwards into the atlas gutter. Adjacent sky must
# never stretch across a grazing-angle silhouette. Eye and mouth recesses are
# retained explicitly rather than incorrectly classified as background.
from collections import deque
valid=((clean[:,:,0]>clean[:,:,1]*1.04)&(clean[:,:,1]>clean[:,:,2]*1.10)&(clean[:,:,0]>clean[:,:,2]*1.35))
valid[279-184:303-184,533-460:657-460]=True
valid[338-184:367-184,558-460:633-460]=True
queue=deque(map(tuple,np.argwhere(valid)))
filled=valid.copy()
while queue:
 y,x=queue.popleft()
 for yy,xx in ((y-1,x),(y+1,x),(y,x-1),(y,x+1)):
  if 0<=yy<valid.shape[0] and 0<=xx<valid.shape[1] and not filled[yy,xx]:
   clean[yy,xx]=clean[y,x];albedo[yy,xx]=albedo[y,x]
   filled[yy,xx]=True;queue.append((yy,xx))
Image.fromarray(np.uint8(clean*255)).save(P/'head-reference-clean.png')
Image.fromarray(np.uint8(albedo*255)).save(P/'head-surface.png')
(P/'surface-provenance.json').write_text(json.dumps({
 'source':'reference.png','sourceSHA256':hashlib.sha256((P/'reference.png').read_bytes()).hexdigest(),
 'crop':box,'texture':'head-surface.png','geometryScope':'continuous head and neck',
 'processing':['Sky-derived scanline compensation','Conservative broad illumination reduction (maximum 16% increase, 15% decrease)','Extend head colors through atlas background to prevent sky bleed at grazing angles'],
 'limitations':['Source directional lighting remains in the material. This is not independently recovered albedo.',
 'No source side/rear view exists. The rear is inferred gold geometry, not photo verified.',
 'Projected appearance and landmark fit cannot independently validate geometry. Inspect clay and side views.'],
 'cameraFacingBillboard':False,'sourceModified':False},indent=2)+'\n')
print('Prepared head surface; original reference preserved.')
