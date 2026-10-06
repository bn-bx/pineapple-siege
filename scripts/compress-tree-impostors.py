from pathlib import Path
import argparse,subprocess,json,hashlib
p=argparse.ArgumentParser();p.add_argument('--toktx',required=True);args=p.parse_args();root=Path(__file__).resolve().parents[1];records=[]
for species in ['pine','broadleaf','riverside']:
 source=root/'art/foliage'/(species+'-impostor.png');target=root/'public/assets/foliage'/(species+'-impostor.ktx2')
 subprocess.run([args.toktx,'--t2','--encode','uastc','--uastc_quality','1','--zcmp','18','--genmipmap','--assign_oetf','srgb',str(target),str(source)],check=True)
 records.append(dict(species=species,source=str(source.relative_to(root)),runtime=str(target.relative_to(root)),sha256=hashlib.sha256(target.read_bytes()).hexdigest(),license='Derived from CC0 branch scans; authored source tree',script='scripts/bake-tree-impostors.py'))
(root/'art/foliage/impostor-provenance.json').write_text(json.dumps(records,indent=2))
