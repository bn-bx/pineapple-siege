"""Download CC0 foliage scans, combine alpha, compress and record provenance."""
from pathlib import Path
import json,urllib.request,hashlib,subprocess,sys
from PIL import Image
root=Path(__file__).resolve().parents[1];out=root/'art/foliage';out.mkdir(parents=True,exist_ok=True)
runtime=root/'public/assets/foliage';runtime.mkdir(parents=True,exist_ok=True)
records=[]
for name,asset,diff,alpha in [('pine','pine_tree_01','twig_diff','twig_alpha'),('broadleaf','jacaranda_tree','leaves_diff','leaves_alpha'),('grass','grass_medium_01','Diffuse','Alpha')]:
 metadata=json.loads(subprocess.check_output(['curl','-fLsS','https://api.polyhaven.com/files/'+asset]))
 (out/(asset+'.json')).write_text(json.dumps(metadata,indent=2))
 paths=[]
 for key in [diff,alpha]:
  info=metadata[key]['1k']['png'];path=out/(name+'-'+key+'.png');subprocess.run(['curl','-fLsS',info['url'],'-o',str(path)],check=True)
  assert hashlib.md5(path.read_bytes()).hexdigest()==info['md5'];paths.append(path)
  records.append(dict(asset=asset,url=info['url'],md5=info['md5'],license='CC0',page='https://polyhaven.com/a/'+asset))
 image=Image.open(paths[0]).convert('RGBA');image.putalpha(Image.open(paths[1]).convert('L'));
 if name=='pine':
  image=image.crop((20,10,250,465)).resize((512,1024))
  # The original atlas includes opaque dilation from neighbouring pinecones.
  # Isolate needles and the central woody shoot before baking branch cards.
  pixels=image.load()
  for y in range(image.height):
   for x in range(image.width):
    r,g,b,a=pixels[x,y];u=x/image.width;v=y/image.height
    if not ((g>=r*.97 and g>b*1.13) or (.43<u<.59 and v>.13)):pixels[x,y]=(r,g,b,0)
 elif name=='broadleaf': image=image.crop((160,10,1024,505)).resize((1024,512))
 combined=out/(name+'.png');image.save(combined)
 subprocess.run([sys.argv[1],'--t2','--encode','uastc','--uastc_quality','1','--zcmp','18','--genmipmap','--assign_oetf','srgb',str(runtime/(name+'.ktx2')),str(combined)],check=True)
(out/'provenance.json').write_text(json.dumps(records,indent=2))
