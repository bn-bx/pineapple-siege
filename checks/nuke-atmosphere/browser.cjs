const {chromium}=require('playwright'),fs=require('fs'),sharp=require('sharp');
(async()=>{
 const b=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist']});
 try{
 const p=await b.newPage({viewport:{width:1280,height:720}}),errors=[];
 p.on('pageerror',e=>errors.push(e.message));
 await p.goto('http://127.0.0.1:4173/#debug');await p.waitForFunction(()=>window.lanternVale?.state.ready,null,{timeout:60000});
 await p.evaluate(()=>{lanternVale.setQuality('720');lanternVale.inspect([1110,120,910],[1210,10,1070]);document.querySelector('#overlay').hidden=true;document.querySelector('#perf').hidden=true;});
 const shot=async name=>{await p.waitForTimeout(150);const data=await p.screenshot({path:`checks/nuke-atmosphere/${name}.png`});const s=await sharp(data).stats();return s.channels.slice(0,3).map(c=>c.mean)};
 const before=await shot('before');
 await p.evaluate(()=>lanternVale.blast([1210,10,1070],'local'));
 const peak=await shot('white-flash');
 await p.evaluate(()=>lanternVale.enter());await p.waitForTimeout(2800);const afterglow=await shot('afterglow');await p.waitForTimeout(5800);await p.evaluate(()=>{lanternVale.pause();document.querySelector('#overlay').hidden=true;});
 const after=await shot('after-flash');
 await p.evaluate(()=>{const e=document.querySelector('#reduceEffects');e.checked=true;e.dispatchEvent(new Event('change'));lanternVale.blast([1210,10,1070],'local');});
 const reduced=await shot('reduced-flash');
 await p.addScriptTag({content:fs.readFileSync('checks/nuke-atmosphere/audio-test.js','utf8')});
 const audio=await p.evaluate(async()=>{
  const ctx=new OfflineAudioContext(2,48000*15,48000), volume=ctx.createGain();volume.gain.value=1;volume.connect(ctx.destination);
  const limiter=BlastAudio.createBlastLimiter(ctx,volume),noise=BlastAudio.createBlastNoise(ctx);
  let ended=0;
  BlastAudio.playNukeBlast(ctx,limiter,noise,{kind:'nuke',p:[0,0,-50],profile:{cloudHeight:400},water:false},()=>ended++);
  const b=await ctx.startRendering(),data=b.getChannelData(0),rms=[];let peak=0;
  for(let sec=0;sec<15;sec++){let energy=0;for(let i=sec*48000;i<(sec+1)*48000;i++){energy+=data[i]*data[i];peak=Math.max(peak,Math.abs(data[i]));}rms.push(Math.sqrt(energy/48000));}
  const bytes=new Uint8Array(44+b.length*4),v=new DataView(bytes.buffer),str=(at,s)=>{for(let i=0;i<s.length;i++)v.setUint8(at+i,s.charCodeAt(i))};
  str(0,'RIFF');v.setUint32(4,bytes.length-8,true);str(8,'WAVE');str(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,2,true);v.setUint32(24,48000,true);v.setUint32(28,192000,true);v.setUint16(32,4,true);v.setUint16(34,16,true);str(36,'data');v.setUint32(40,b.length*4,true);
  for(let i=0;i<b.length;i++)for(let c=0;c<2;c++)v.setInt16(44+i*4+c*2,Math.max(-1,Math.min(1,b.getChannelData(c)[i]))*32767,true);
  let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
  const stress=new OfflineAudioContext(2,48000*2,48000),stressLimiter=BlastAudio.createBlastLimiter(stress,stress.destination),stressNoise=BlastAudio.createBlastNoise(stress);
  const voices=[];for(let i=0;i<8;i++){if(voices.length>=4)voices.shift().stop();voices.push(BlastAudio.playNukeBlast(stress,stressLimiter,stressNoise,{kind:'nuke',p:[0,0,-50],profile:{cloudHeight:400},water:false}));}
  const mixed=await stress.startRendering();let overlapPeak=0;for(const value of mixed.getChannelData(0))overlapPeak=Math.max(overlapPeak,Math.abs(value));
  return {peak,rms,ended,overlapPeak,wav:btoa(binary)};
 });
 fs.writeFileSync('checks/nuke-atmosphere/nuke-sound.wav',Buffer.from(audio.wav,'base64'));delete audio.wav;
 const result={audio,afterglow,browser:await b.version(),before,peak,after,reduced,errors,gl:await p.evaluate(()=>lanternVale.renderer.getContext().getError())};
 result.passed=peak.every((v,i)=>v>before[i]+50)&&peak.every((v,i)=>v>after[i]+50)&&peak.every((v,i)=>v>reduced[i]+40)&&afterglow.some((v,i)=>v>after[i]+10)&&audio.peak<1&&audio.overlapPeak<1&&audio.rms[5]>0.0001&&audio.rms[14]<0.00001&&audio.ended===1&&!errors.length&&!result.gl;
 fs.writeFileSync('checks/nuke-atmosphere/report.json',JSON.stringify(result,null,2));console.log(result);if(!result.passed)process.exitCode=1;
 }finally{await b.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
