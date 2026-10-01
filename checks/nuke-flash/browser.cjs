const {chromium}=require('playwright'),fs=require('fs'),sharp=require('sharp');
(async()=>{
 const b=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist']});
 try{
 const p=await b.newPage({viewport:{width:1280,height:720}}),errors=[];
 p.on('pageerror',e=>errors.push(e.message));
 await p.goto('http://127.0.0.1:4173/#debug');await p.waitForFunction(()=>window.lanternVale?.state.ready,null,{timeout:60000});
 await p.evaluate(()=>{lanternVale.setQuality('720');lanternVale.inspect([1110,120,910],[1210,10,1070]);document.querySelector('#overlay').hidden=true;document.querySelector('#perf').hidden=true;});
 const shot=async name=>{await p.waitForTimeout(150);const data=await p.screenshot({path:`checks/nuke-flash/${name}.png`});const s=await sharp(data).stats();return s.channels.slice(0,3).map(c=>c.mean)};
 const before=await shot('before');
 await p.evaluate(()=>lanternVale.blast([1210,10,1070],'local'));
 const peak=await shot('white-flash');
 await p.evaluate(()=>lanternVale.enter());await p.waitForTimeout(3200);await p.evaluate(()=>{lanternVale.pause();document.querySelector('#overlay').hidden=true;});
 const after=await shot('after-flash');
 await p.evaluate(()=>{const e=document.querySelector('#reduceEffects');e.checked=true;e.dispatchEvent(new Event('change'));lanternVale.blast([1210,10,1070],'local');});
 const reduced=await shot('reduced-flash');
 const result={browser:await b.version(),before,peak,after,reduced,errors,gl:await p.evaluate(()=>lanternVale.renderer.getContext().getError())};
 result.passed=peak.every((v,i)=>v>before[i]+50)&&peak.every((v,i)=>v>after[i]+50)&&peak.every((v,i)=>v>reduced[i]+40)&&!errors.length&&!result.gl;
 fs.writeFileSync('checks/nuke-flash/report.json',JSON.stringify(result,null,2));console.log(result);if(!result.passed)process.exitCode=1;
 }finally{await b.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
