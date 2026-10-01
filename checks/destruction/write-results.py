from pathlib import Path
import json
folder=Path(__file__).parent
rows=[]; details=[]
for name in ['safari','chrome']:
 p=folder/(name+'-report.json')
 if not p.exists(): continue
 d=json.loads(p.read_text())
 for phase in ['normal','destruction']:
  s=d[phase]
  rows.append(f"| {name.title()} | {phase.title()} | {s['medianMS']:.1f} ms | {s['p95MS']:.1f} ms | {s['p99MS']:.1f} ms | {s['maxMS']:.1f} ms | {s['over100MS']} |")
 bounded=d['maxBodies']<=256 and d['maxFragments']<=4096 and d['maxClouds']<=3 and d['maxJobs']<=8
 details.append(f"### {name.title()}\n\n- User agent: `{d['userAgent']}`.\n- {d['durationSeconds']:.1f} seconds, {d['nukes']} nuke drops, {d['stats']['shots']} total shots, {d['stats']['removed']} removed components.\n- Sampled maxima: {d['maxBodies']}/256 bodies, {d['maxFragments']}/4,096 cosmetic chunks, {d['maxClouds']}/3 clouds, {d['maxJobs']}/8 jobs. Bounds {'passed' if bounded else 'FAILED'}.\n- Largest sampled additional destruction work: {d['maxDestructionMS']:.1f} ms.\n- Final {d['stats']['ruins']} rubble records; approximate save payload {d['saveBytes']/1024/1024:.2f} MiB; {d['pendingSaved']} saved pending jobs.\n- Main-page heap: {str(round(d['maxHeap']/1024/1024,1))+' MiB sampled maximum' if d['maxHeap'] else 'not exposed by this browser'}.\n- Captured page/rejection errors: {len(d['errors'])}; final WebGL error: {d['glError']}.\n- Normal-flight median near-60-FPS criterion: {'passed' if d['normal']['medianMS']<=18 else 'not met'}. Destruction p95 ≤33.5 ms criterion: {'passed' if d['destruction']['p95MS']<=33.5 else 'not met'}. These are route-specific measurements, not a guarantee for every viewpoint.\n")
text='## Completed timed results\n\n| Browser | Phase | Median | p95 | p99 | Worst frame | Frames >100 ms |\n| --- | --- | --- | --- | --- | --- | --- |\n'+'\n'.join(rows)+'\n\n'+'\n'.join(details)+'\nThe first 30 seconds measure normal flight around the castle. Later flight revisits increasingly ruined areas, so the destruction aggregate includes both active blasts and settled aftermath. Worst-frame values cover the entire destruction phase; they are not individually attributed to a specific impact. Safari and Chrome expose different timing/memory facilities, and physics trajectories vary between runs. The reports do not measure total-process or GPU memory.\n'
p=folder/'VERIFICATION.md';s=p.read_text();marker='## Completed timed results';s=s.split(marker)[0].rstrip()+'\n\n'+text;p.write_text(s)
