"""Source-image body contour annotations, independent of candidate geometry.
The original coarse reference trace undersized the raised hand/forearm. Preserve
it for audit, then draw a revised trace checked against the source pixel grid.
This remains a manual estimate, not ground-truth segmentation.
"""
from pathlib import Path
import json,shutil
import numpy as np
from PIL import Image,ImageDraw
P=Path(__file__).resolve().parents[2]/'public/review/pineapple-god'
old=P/'reference-body-mask-v1.png'
if not old.exists():shutil.copyfile(P/'reference-body-mask.png',old)
polygons={
 'neck':[(490,410),(654,410),(668,440),(741,465),(752,482),(391,484),(372,462),(482,448)],
 'torso':[(378,478),(421,468),(552,480),(582,491),(617,482),(751,469),(801,489),(822,550),(801,623),(767,681),(750,757),(738,776),(431,776),(418,717),(389,676),(369,624),(348,556),(355,508)],
 'left-shoulder':[(280,503),(298,481),(336,470),(362,476),(379,492),(393,527),(382,563),(360,588),(330,596),(306,581),(285,554)],
 'left-upper-arm':[(306,555),(343,547),(376,561),(392,599),(391,632),(371,670),(343,705),(312,724),(289,718),(278,688),(286,637),(289,593)],
 'left-forearm':[(143,581),(174,578),(206,581),(241,575),(270,587),(301,611),(317,648),(311,689),(294,718),(267,739),(230,746),(198,733),(171,706),(151,668),(135,618)],
 'left-grip':[(149,480),(162,458),(187,447),(220,445),(251,457),(270,475),(268,495),(257,513),(256,534),(244,550),(222,559),(213,580),(183,587),(158,573),(144,548),(141,519)],
 'left-cuff':[(132,549),(145,541),(161,548),(157,576),(186,591),(219,590),(241,583),(246,610),(226,628),(194,631),(166,619),(147,600),(135,579)],
 'right-shoulder':[(768,485),(801,473),(831,483),(855,500),(869,532),(865,558),(849,578),(819,591),(790,577),(769,550),(760,521)],
 'right-upper-arm':[(826,553),(868,555),(893,578),(915,611),(927,647),(914,680),(892,698),(860,685),(838,662),(821,629),(815,590)],
 'right-forearm':[(872,637),(905,640),(931,665),(950,693),(950,721),(937,745),(915,763),(888,755),(869,735),(856,699),(856,670)],
 'right-hand':[(876,737),(912,735),(943,750),(961,774),(966,802),(954,827),(939,846),(913,851),(882,844),(867,825),(858,810),(860,778)],
 'left-thigh':[(331,802),(365,777),(409,775),(451,793),(478,828),(483,866),(465,906),(436,947),(393,969),(350,957),(321,919),(308,871)],
 'right-thigh':[(689,798),(727,776),(769,782),(806,809),(829,852),(827,901),(803,941),(766,962),(722,956),(691,930),(671,887),(671,839)],
 'left-shin':[(354,923),(402,932),(428,967),(423,1012),(409,1051),(374,1072),(327,1067),(308,1045),(313,1007),(330,957)],
 'right-shin':[(733,933),(776,925),(807,953),(827,993),(832,1039),(813,1069),(766,1076),(729,1051),(716,1007),(718,966)],
 'cloth':[(430,758),(739,758),(713,796),(697,1063),(450,1063),(448,796)],
 'scepter-shaft':[(204,341),(225,341),(225,1036),(207,1036)],
}
mask=Image.open(old).convert('L');d=ImageDraw.Draw(mask);d.rectangle((125,440,980,1085),fill=0)
d.rectangle((350,415,760,490),fill=0)
for name,poly in polygons.items():
 if name!='neck':d.polygon(poly,fill=255)
# Neck and necklace are isolated gold against sky, allowing a source-only
# color segmentation more faithful than the coarse joining neck polygon.
a=np.asarray(Image.open(P/'reference.png').convert('RGB'),dtype=float)
r,g,b=a[:,:,0],a[:,:,1],a[:,:,2]
gold=(r>g*1.04)&(g>b*1.1)&(r>b*1.35)&(r>25)
region=np.zeros(gold.shape,dtype=bool);region[415:491,350:761]=True
m=np.asarray(mask).copy();m[gold&region]=255;mask=Image.fromarray(m)
mask.save(P/'reference-body-mask.png')
reference=Image.open(P/'reference.png').convert('RGB');draw=ImageDraw.Draw(reference)
for name,poly in polygons.items():
 draw.line(poly+[poly[0]],fill='#e95e5a',width=2)
reference.save(P/'reference-body-trace.png')
(P/'body-reference-trace.json').write_text(json.dumps({'revision':2,'source':'reference.png','method':'Manual image-coordinate contour trace checked against enlarged source pixel grid. Gold neck/collar is segmented from source colors. No candidate mesh vertices or silhouettes used.','supersedes':'reference-body-mask-v1.png','limitations':['Contours remain approximate, especially at occlusion and garment boundaries.','Side/rear shapes cannot be verified from this trace.','Architecture is excluded from the figure diagnostic.'],'polygons':polygons},indent=2)+'\n')
print('Reference trace v2 written; original coarse trace retained for audit.')
