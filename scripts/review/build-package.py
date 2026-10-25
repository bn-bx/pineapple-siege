"""Build inspectable comparisons from actual renderer captures; never edits reference.png."""
from pathlib import Path
import json,hashlib
import numpy as np
from PIL import Image,ImageDraw,ImageFont
ROOT=Path(__file__).resolve().parents[2]
P=ROOT/'public/review/pineapple-god';C=P/'captures'
a=json.loads((P/'annotations.json').read_text());r=json.loads((C/'measurements.json').read_text())
acceptance=json.loads((P/'visual-acceptance.json').read_text())
body_accepted=acceptance.get('body')=='visually accepted by user'
review_label='Head and body accepted; in-game review pending.' if body_accepted else 'Head accepted; body visual review pending.'
provenance=json.loads((P/'reference-provenance.json').read_text())
assert hashlib.sha256((P/'reference.png').read_bytes()).hexdigest()==provenance['sha256']
reference=Image.open(P/'reference.png').convert('RGB');candidate=Image.open(C/'whole.png').convert('RGB')
assert candidate.size==reference.size==tuple(a['size'])
try: font=ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf',24)
except OSError: font=ImageFont.load_default()
box=tuple(a['headCrop']);scale=3
ref=reference.crop(box).resize(((box[2]-box[0])*scale,(box[3]-box[1])*scale))
model=candidate.crop(box).resize(ref.size)
ref.save(C/'head-reference.png');model.save(C/'head-candidate.png')
def pair(left,right,title_left,title_right,name):
 w,h=left.size;out=Image.new('RGB',(w*2+40,h+100),'#111715');d=ImageDraw.Draw(out)
 d.text((16,14),title_left,font=font,fill='white');d.text((w+56,14),title_right,font=font,fill='white')
 d.text((16,52),'Fixed camera. '+review_label,font=font,fill='#d4bd7b')
 out.paste(left,(0,100));out.paste(right,(w+40,100));out.save(C/name)
pair(ref,model,'YOUR ORIGINAL REFERENCE','PHOTO-SURFACED 3D HEAD','head-comparison.png')
pair(reference,candidate,'YOUR ORIGINAL REFERENCE','3D REVIEW CANDIDATE','whole-comparison.png')
body_box=(125,435,980,1090)
body_ref=reference.crop(body_box);body_model=candidate.crop(body_box)
body_clay=Image.open(C/'clay-whole.png').convert('RGB').crop(body_box)
pair(body_ref,body_model,'YOUR REFERENCE BODY','REBUILT 3D BODY','body-comparison.png')
pair(body_ref,body_clay,'REFERENCE APPEARANCE','ACTUAL CLAY GEOMETRY','body-clay-comparison.png')
pair(Image.open(C/'body-before-whole.png').convert('RGB').crop(body_box),body_model,'PREVIOUS BODY','REBUILT BODY','body-before-after.png')
Image.blend(body_ref,body_model,.5).save(C/'body-overlay.png')
trip_body=Image.new('RGB',(body_ref.width*3+40,body_ref.height+100),'#111715');dt=ImageDraw.Draw(trip_body)
for i,(im,title) in enumerate([(body_ref,'REFERENCE'),(body_model,'REFERENCE SURFACE'),(body_clay,'CLAY GEOMETRY')]):
 x=i*(body_ref.width+20);dt.text((x+12,15),title,font=font,fill='white');trip_body.paste(im,(x,100))
dt.text((12,53),'Hidden cloth and rear anatomy are reconstructed. Surface texture is not independent geometry proof.',font=font,fill='#d4bd7b')
trip_body.save(C/'body-surface-and-clay.png')
Image.blend(ref,model,.5).save(C/'head-overlay.png')
Image.blend(reference,candidate,.5).save(C/'whole-overlay.png')
valid=np.array(Image.open(P/'valid-mask.png'))>127
rh=np.array(Image.open(P/'reference-head-mask.png'))>127;ch=np.array(Image.open(C/'head-mask.png'))[:,:,0]>127
rb=np.array(Image.open(P/'reference-body-mask.png'))>127;cb=np.array(Image.open(C/'body-mask.png'))[:,:,0]>127
for title,aa,bb,crop,name in [('Head outline',rh,ch,box,'head-silhouette-difference.png'),('Figure outline',rb,cb,None,'whole-silhouette-difference.png')]:
 pixels=np.zeros((*aa.shape,3),dtype=np.uint8);pixels[aa&bb&valid]=[145,155,145];pixels[aa&~bb&valid]=[255,85,65];pixels[bb&~aa&valid]=[50,190,255]
 im=Image.fromarray(pixels)
 if crop:im=im.crop(crop).resize(ref.size)
 out=Image.new('RGB',(im.width,im.height+80),'#111715');d=ImageDraw.Draw(out)
 d.text((12,12),title,font=font,fill='white');d.text((12,44),'RED missing / CYAN extra / GRAY overlap',font=font,fill='#d4bd7b');out.paste(im,(0,80));out.save(C/name)
# Clay comparisons expose anatomy independently of the projected source pixels.
clay=Image.open(C/'clay-whole.png').convert('RGB').crop(box).resize(ref.size)
pair(ref,clay,'REFERENCE / APPEARANCE','CLAY / ACTUAL GEOMETRY','head-clay-comparison.png')
trip=Image.new('RGB',(ref.width*3+40,ref.height+100),'#111715');dt=ImageDraw.Draw(trip)
for i,(im,title) in enumerate([(ref,'REFERENCE'),(model,'REFERENCE SURFACE'),(clay,'CLAY GEOMETRY')]):
 x=i*(ref.width+20);dt.text((x+12,15),title,font=font,fill='white');trip.paste(im,(x,100))
dt.text((12,53),'Photo appearance is source-dependent. Inspect clay and side views before accepting.',font=font,fill='#d4bd7b')
trip.save(C/'head-surface-and-clay.png')
# A raw color-difference map exposes shading/material differences that IoU hides.
rgb=np.asarray(reference,dtype=float);cg=np.asarray(candidate,dtype=float)
error=np.abs(rgb-cg).mean(axis=2);shown=np.clip(error*5,0,255).astype('uint8')
heat=np.zeros((*valid.shape,3),dtype=np.uint8);m=rh&ch&valid;heat[m,0]=shown[m];heat[m,1]=shown[m]//2
Image.fromarray(heat).crop(box).resize(ref.size).save(C/'head-appearance-difference.png')
# Annotate original source points versus observed rendered points, independently
# of the asset's authored vertices. Error vectors are deliberately visible.
if not r.get('observations'):
 (C/'head-landmarks.png').unlink(missing_ok=True)
if r.get('observations'):
 left=ref.copy();right=model.copy();dl=ImageDraw.Draw(left);dr=ImageDraw.Draw(right)
 for index,(name,target) in enumerate(list(a['landmarks'].items())[:16]):
  observed=r['observations'].get(name)
  if not observed:continue
  x=(target[0]-box[0])*scale;y=(target[1]-box[1])*scale
  ox=(observed[0]-box[0])*scale;oy=(observed[1]-box[1])*scale
  dl.ellipse((x-4,y-4,x+4,y+4),outline='#ff6655',width=2)
  dl.text((x+6,y-14),str(index),fill='white',stroke_width=1,stroke_fill='black')
  dr.line((x,y,ox,oy),fill='#ff6655',width=2);dr.ellipse((ox-4,oy-4,ox+4,oy+4),outline='#77ffcc',width=2)
  dr.text((ox+6,oy-14),str(index),fill='white',stroke_width=1,stroke_fill='black')
 pair(left,right,'REFERENCE LANDMARKS','OBSERVED RENDERED POINTS (approx.)','head-landmarks.png')
notes={
 'status':review_label+' '+acceptance['inGame'],
 'revisionScope':'Continuous torso/arms/hands, seated hip-to-calf forms, drapery, cuffs, necklace, scepter shaft and stairs. Approved head geometry and texture preserved.',
 'headOutline':{'score':r['headIoU'],'threshold':.97,'pass':r['headIoU']>=.97,'scope':'Head ROI segmented from reference colors; boundary ambiguity remains at gold neck/crown joins.'},
 'figureOutline':{'score':r['bodyIoU'],'threshold':.95,'pass':r['bodyIoU']>=.95,'scope':'Figure only. Throne/architecture require visual review. Hand-traced accessory contours share authoring constraints.'},
 'facialLandmarks':r['face'],
 'surfaceProjection':r.get('referenceSurface'),'geometryEvidence':'Photo-surface landmarks cannot independently verify geometry; inspect clay and side captures.',
 'visualReview':{'headAndNeck':r.get('headReview'),'body':acceptance.get('body','awaiting explicit acceptance'),'wholeStatue':acceptance['wholeStatue'],'inGame':acceptance['inGame']},
 'bodySurface':r.get('bodySurface'),'clothSurface':r.get('clothSurface'),'renderBudget':r.get('renderBudget'),
 'remainingChecks':[
 'Body outline is fitted to source trace v2; overlap reports constraint satisfaction, not independent proof of likeness. Source trace remains approximate.',
 'Review continuous anatomy in body-clay-comparison.png, clay-three.png and clay-side.png. Photographic shading remains in the material.',
 'Aircraft-hidden fabric is reconstructed using a separate vertical cloth atlas; no unseen source anatomy is certified.',
 'Production integration uses packed geometry with stable damage owners. Final in-game visual acceptance remains pending.'],
 'files':['body-comparison.png','body-clay-comparison.png','body-before-after.png','body-surface-and-clay.png','body-overlay.png','whole-comparison.png','whole-overlay.png','whole-silhouette-difference.png','three.png','side.png','clay-three.png','clay-side.png','head-comparison.png','measurements.json'],
 'referenceSHA256':provenance['sha256'],'sculptSHA256':hashlib.sha256((P/'sculpt.json').read_bytes()).hexdigest(),
 'browserErrors':r['browserErrors']}
(C/'review-status.json').write_text(json.dumps(notes,indent=2)+'\n')
md=f'''# Pineapple god — body review

**{review_label} {acceptance['inGame']}.**

- Head geometry and texture remain unchanged from the accepted candidate.
- Head-outline diagnostic: {r['headIoU']:.1%} (97% threshold).
- Figure-outline constraint fit: {r['bodyIoU']:.1%} (95% threshold; figure-only scope).
- The body uses connected anatomical forms and source-derived UV detail. The hidden cloth has a separate reconstructed atlas.

Start with [body-comparison.png](body-comparison.png), [body-before-after.png](body-before-after.png), and [body-surface-and-clay.png](body-surface-and-clay.png). Use [clay-three.png](clay-three.png) and [clay-side.png](clay-side.png) to inspect actual volume.

The original source remains unchanged. Reference contour v2 was corrected from the source image's pixel grid and is retained separately from the earlier coarse trace. The body was fitted to that trace: the overlap score is an authoring-constraint check, not independent appearance proof. Photo-projected appearance also cannot establish anatomy. Source lighting remains in the textures, and hidden surfaces are inferred.

The approved sculpt is now integrated. Actual game captures are in ../game-captures/. User acceptance of the final in-game result remains pending.

Read [review-status.json](review-status.json) for remaining checks and hashes.
'''
(C/'README.md').write_text(md)
print(f'Comparison package built. Head {r["headIoU"]:.1%}; figure {r["bodyIoU"]:.1%}; {review_label}')
