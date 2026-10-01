const {chromium}=require('playwright'),fs=require('fs');
(async()=>{
 const b=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist']});
 const p=await b.newPage({viewport:{width:1920,height:1080}}),errors=[],views=[];p.on('pageerror',e=>errors.push(e.message));
 await p.goto('http://127.0.0.1:4173/#debug');await p.waitForFunction(()=>window.lanternVale?.state.ready,{},{timeout:60000});
 await p.evaluate(()=>{lanternVale.setQuality('1080');document.querySelector('#perf').hidden=true;});
 await p.screenshot({path:'checks/jet/final-entry.png'});
 await p.locator('#enter').click();await p.evaluate(()=>{lanternVale.pause();document.querySelector('#overlay').hidden=true;});
 for(const v of [
  {name:'castle',eye:[1070,83,932],target:[1118,19,1044],hour:15.5},
  {name:'water',eye:[1005,17,946],target:[1060,3,1040],hour:12},
  {name:'forest',eye:[935,43,1080],target:[991,17,1120],hour:16},
  {name:'night',eye:[1100,31,996],target:[1120,12,1044],hour:22}
 ]) {
  await p.evaluate(v=>{lanternVale.inspect(v.eye,v.target);lanternVale.send({type:'hour',hour:v.hour});},v);
  await p.waitForTimeout(1200);
  const frames=await p.evaluate(()=>new Promise(resolve=>{const times=[];let last=performance.now(),start=last;function f(now){times.push(now-last);last=now;if(now-start<12000)requestAnimationFrame(f);else resolve(times)}requestAnimationFrame(f)}));frames.sort((a,b)=>a-b);
  views.push({...v,medianMS:frames[Math.floor(frames.length*.5)],p95MS:frames[Math.floor(frames.length*.95)],maxMS:Math.max(...frames),frames:frames.length,render:await p.evaluate(()=>lanternVale.state.render)});
  await p.screenshot({path:`checks/jet/final-${v.name}.png`});
 }
 await p.evaluate(()=>{lanternVale.enter();lanternVale.send({type:'hour',hour:15.5});lanternVale.inspect([1070,83,932],[1118,19,1044]);lanternVale.blast([1086,11,1012]);});await p.waitForTimeout(350);await p.screenshot({path:'checks/jet/final-blast.png'});await p.evaluate(()=>{lanternVale.pause();document.querySelector('#overlay').hidden=true;});
 await p.evaluate(()=>lanternVale.step(800));await p.waitForTimeout(500);await p.screenshot({path:'checks/jet/final-ruins.png'});
 fs.writeFileSync('checks/jet/view-report.json',JSON.stringify({browser:await b.version(),viewport:[1920,1080],note:'Fixed camera, simulation paused; frame timings measure rendering only.',views,errors},null,2));
 console.log(JSON.stringify({views,errors}));await b.close();
})().catch(e=>{console.error(e);process.exit(1)});
