"""Locally package licensed recordings; retain originals, provenance and edits."""
from pathlib import Path
import subprocess,json,hashlib,wave
root=Path(__file__).resolve().parents[1];out=root/'art/audio';out.mkdir(parents=True,exist_ok=True);runtime=root/'public/assets/audio';runtime.mkdir(parents=True,exist_ok=True)
assets=[('river','park_ambience_river.wav','Thimras','CC0','park-ambiences'),('wind','park_ambience_wind.wav','Thimras','CC0','park-ambiences'),('forest','Forest_Ambience.mp3','TinyWorlds','CC0','forest-ambience'),('turbine','engine_takeoff.wav','dklon','CC-BY-3.0','jet-engine-takeoff'),('explosion','mechanical_explosion.wav','Spring Spring','CC0','mechanical-explosion'),('cheer','cheers.ogg','AuraVoice / Nocturnal_Vanguard','CC0','cheers-0'),('wood','saw_-_starninjas.ogg','StarNinjas','CC0','saw-or-wood-impact'),('stone','rock_break.ogg','themightyglider / SoundCollectah','CC0','breaking-rock')]
records=[]
for name,file,author,license,page in assets:
 url='https://opengameart.org/sites/default/files/'+file;source=out/file
 
 if not source.exists(): subprocess.run(['curl','-fLsS',url,'-o',str(source)],check=True)
 if file.endswith('.ogg'):
  import shutil
  shutil.copyfile(source,runtime/(name+'.ogg'))
  records.append(dict(name=name,source=url,page='https://opengameart.org/content/'+page,author=author,license=license,sha256=hashlib.sha256(source.read_bytes()).hexdigest(),edits='Original Ogg recording'))
  continue
 decoded=out/(name+'-decoded.wav');subprocess.run(['/usr/bin/afconvert',str(source),str(decoded),'-f','WAVE','-d','LEI16@22050','-c','1'],check=True)
 with wave.open(str(decoded),'rb') as w:
  rate=w.getframerate();data=w.readframes(min(w.getnframes(),rate*(20 if name in ['river','wind','forest'] else 8)))
 # Blend endpoints of ambient loops; source waveform is preserved otherwise.
 if name in ['river','wind','forest']:
  import array
  samples=array.array('h');samples.frombytes(data);fade=min(rate,len(samples)//4)
  for i in range(fade):samples[i]=round(samples[i]*i/fade+samples[len(samples)-fade+i]*(1-i/fade))
  data=samples.tobytes()
 target=runtime/(name+'.wav')
 with wave.open(str(target),'wb') as w:w.setnchannels(1);w.setsampwidth(2);w.setframerate(rate);w.writeframes(data)
 decoded.unlink()
 records.append(dict(name=name,source=url,page='https://opengameart.org/content/'+page,author=author,license=license,sha256=hashlib.sha256(source.read_bytes()).hexdigest(),edits='Mono 22050 Hz; truncated; ambient endpoint crossfade'))
(out/'provenance.json').write_text(json.dumps(records,indent=2))
(runtime/'CREDITS.md').write_text('\n'.join(f"- {r['name']}: {r['author']}, {r['license']}. {r['page']} Modified: {r['edits']}." for r in records)+'\nCC-BY-3.0: https://creativecommons.org/licenses/by/3.0/\n')
