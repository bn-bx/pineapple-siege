const {chromium}=require('playwright'),fs=require('fs');
(async()=>{
 const b=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist']});
 const p=await b.newPage({viewport:{width:1920,height:1080}}),errors=[];
 p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
 await p.goto('http://127.0.0.1:4173/#debug');await p.waitForFunction(()=>window.lanternVale?.state.ready,{},{timeout:60000});
 await p.evaluate(()=>{lanternVale.setQuality('1080');lanternVale.send({type:'holdTime',hold:true});lanternVale.send({type:'nukeYield',value:'valley'});document.querySelector('#mute').checked=true;document.querySelector('#mute').dispatchEvent(new Event('change'))});
 await p.locator('#enter').click();
 await p.evaluate(()=>{
  lanternVale.setPlane([1170,320,800],Math.PI/2,0);window.measureStart=performance.now();window.nukeDrops=0;window.sawNukeCooldown=0;window.stressFrames=[];window.lastStressFrame=0;
  requestAnimationFrame(function collect(t){if(lastStressFrame)stressFrames.push({t:(t-measureStart)/1000,ms:t-lastStressFrame});lastStressFrame=t;requestAnimationFrame(collect)});
  window.pilotTimer=setInterval(()=>{const g=lanternVale,s=g.state.snapshot;if(!s)return;const plane=s.plane,pos=plane.p,t=(performance.now()-measureStart)/1000;
   const angle=Math.atan2(pos[0]-1170,pos[2]-1070)+.5,target=[1170+Math.sin(angle)*270,320,1070+Math.cos(angle)*270];
   const dx=target[0]-pos[0],dz=target[2]-pos[2],yaw=Math.atan2(dx,dz),pitch=Math.atan2(target[1]-pos[1],Math.max(15,Math.hypot(dx,dz))),diff=Math.atan2(Math.sin(yaw-plane.yaw),Math.cos(yaw-plane.yaw));
   if(s.cooldowns.nuke>9.5&&sawNukeCooldown<5)nukeDrops++;sawNukeCooldown=s.cooldowns.nuke;
   const selected=t>30&&s.cooldowns.nuke<.12?'nuke':'cannon';if(s.weapon!==selected)g.send({type:'weapon',weapon:selected});
   g.controls({x:Math.max(-1,Math.min(1,-diff*2)),y:Math.max(-1,Math.min(1,(pitch-plane.pitch)*3)),bank:0,throttle:0,boost:false,fire:t>30});
  },50);
 });
 const start=Date.now(),duration=Number(process.env.RUN_SECONDS||300),checkpoints=[];let next=30,maxBodies=0,maxJobs=0,maxClouds=0,maxHeap=0,maxDestructionMS=0;
 while(Date.now()-start<duration*1000){await p.waitForTimeout(500);const s=await p.evaluate(()=>({stats:lanternVale.state.snapshot.stats,render:lanternVale.state.render,p:lanternVale.state.snapshot.plane.p,active:lanternVale.state.active,heap:performance.memory?.usedJSHeapSize,nukes:nukeDrops,simTime:lanternVale.state.snapshot.time}));maxBodies=Math.max(maxBodies,s.stats.bodies);maxJobs=Math.max(maxJobs,s.stats.pendingJobs);maxClouds=Math.max(maxClouds,s.render.clouds);maxHeap=Math.max(maxHeap,s.heap||0);maxDestructionMS=Math.max(maxDestructionMS,s.stats.destructionMS);const elapsed=(Date.now()-start)/1000;if(elapsed>=next){checkpoints.push({elapsed,...s});console.log(JSON.stringify(checkpoints.at(-1)));next+=30}if(!s.active)throw Error('Unexpected pause');}
 const final=await p.evaluate(async()=>{clearInterval(pilotTimer);lanternVale.pause();const save=await lanternVale.save();const summarize=(a)=>{const v=a.map(x=>x.ms).sort((a,b)=>a-b);return {frames:v.length,medianMS:v[Math.floor(v.length*.5)],p95MS:v[Math.floor(v.length*.95)],p99MS:v[Math.floor(v.length*.99)],maxMS:Math.max(...v),over100MS:v.filter(x=>x>100).length}};return {normal:summarize(stressFrames.filter(x=>x.t>3&&x.t<30)),destruction:summarize(stressFrames.filter(x=>x.t>30)),stats:lanternVale.state.snapshot.stats,nukes:nukeDrops,saveBytes:new Blob([JSON.stringify({...save,terrain:[]})]).size+save.terrain.byteLength,pendingSaved:save.pendingJobs.length,glError:lanternVale.renderer.getContext().getError()}});
 await p.screenshot({path:'checks/upgrade/stress-final.png'});const report={browser:await b.version(),viewport:[1920,1080],durationSeconds:(Date.now()-start)/1000,maxBodies,maxJobs,maxClouds,maxHeap,maxDestructionMS,checkpoints,final,errors,bounded:errors.length===0&&maxBodies<=256&&maxJobs<=8&&maxClouds<=3&&final.glError===0,performanceTarget:final.normal.medianMS<=18&&final.destruction.p95MS<=33.5};fs.writeFileSync('checks/upgrade/stress-report.json',JSON.stringify(report,null,2));console.log('FINAL',JSON.stringify(report));await b.close();if(!report.bounded)process.exitCode=1;
})().catch(e=>{console.error(e);process.exit(1)});
