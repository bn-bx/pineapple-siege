const {chromium}=require('playwright'),fs=require('fs');
(async()=>{
 const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist']});
 const checks=[],errors=[];try{
 const page=await browser.newPage({viewport:{width:1920,height:1080},acceptDownloads:true});page.on('pageerror',e=>errors.push(e.message));
 const check=(name,passed,detail)=>{const result={name,passed:!!passed,detail};checks.push(result);console.log(JSON.stringify(result));};
 const ready=()=>page.waitForFunction(()=>window.lanternVale?.state.ready,null,{timeout:120000});
 await page.goto('http://127.0.0.1:4173/#debug');await ready();
 check('Brand and fresh Valley-scale default',await page.title()==='Pineapple Siege'&&await page.locator('#nukeYield').inputValue()==='valley');
 await page.evaluate(()=>document.querySelectorAll('details').forEach(e=>e.open=true));
 for(const id of ['mute','reduceEffects','reduceShake','holdTime','showPerf'])await page.locator('#'+id).check();
 await page.locator('#quality').selectOption('720');await page.locator('#nukeYield').selectOption('local');
 await page.locator('#volume').evaluate(e=>{e.value='.6';e.dispatchEvent(new Event('input'));});await page.waitForTimeout(300);await page.reload();await ready();
 check('All settings reload and chosen strength survives migration',await page.evaluate(()=>['mute','reduceEffects','reduceShake','holdTime','showPerf'].every(id=>document.getElementById(id).checked)&&document.getElementById('volume').value==='0.6'&&document.getElementById('quality').value==='720'&&document.getElementById('nukeYield').value==='local'));
 await page.evaluate(()=>document.querySelectorAll('details').forEach(e=>e.open=false));await page.screenshot({path:'checks/polish/entry.png'});
 await page.evaluate(()=>lanternVale.enter());await page.waitForTimeout(300);
 await page.keyboard.press('c');await page.waitForTimeout(500);check('C enters live cinematic mode',await page.evaluate(()=>lanternVale.state.active&&lanternVale.state.cameraMode==='cinematic'));
 await page.screenshot({path:'checks/polish/cinematic.png'});
 await page.keyboard.press('p');await page.waitForFunction(()=>lanternVale.state.cameraMode==='photo');
 const frozen=await page.evaluate(()=>({tick:lanternVale.state.snapshot.tick,time:lanternVale.state.render.effectTime,hour:lanternVale.state.snapshot.hour,p:lanternVale.state.snapshot.plane.p,cam:lanternVale.camera.position}));
 await page.locator('canvas').click({position:{x:600,y:300}});await page.keyboard.down('w');await page.waitForTimeout(500);await page.keyboard.up('w');
 const after=await page.evaluate(()=>({tick:lanternVale.state.snapshot.tick,time:lanternVale.state.render.effectTime,hour:lanternVale.state.snapshot.hour,p:lanternVale.state.snapshot.plane.p,cam:lanternVale.camera.position}));
 check('Photo freezes tick, time, effects, and aircraft while camera moves',frozen.tick===after.tick&&frozen.time===after.time&&frozen.hour===after.hour&&JSON.stringify(frozen.p)===JSON.stringify(after.p)&&JSON.stringify(frozen.cam)!==JSON.stringify(after.cam),{frozen,after});
 await page.locator('#photoFov').evaluate(e=>{e.value='40';e.dispatchEvent(new Event('input'));});await page.waitForTimeout(100);check('Photo FOV applies',await page.evaluate(()=>lanternVale.camera.fov===40));
 const downloaded=page.waitForEvent('download');await page.locator('#savePhoto').click();const download=await downloaded;await download.saveAs('checks/polish/photo.png');check('PNG export',fs.statSync('checks/polish/photo.png').size>10000);
 await page.keyboard.press('h');check('H hides photo toolbar',await page.locator('#photoToolbar').isHidden());await page.keyboard.press('h');
 await page.keyboard.press('p');await page.waitForTimeout(200);check('P restores live cinematic mode',await page.evaluate(()=>lanternVale.state.active&&lanternVale.state.cameraMode==='cinematic'));
 await page.keyboard.press('c');check('C returns to chase',await page.evaluate(()=>lanternVale.state.cameraMode==='chase'));
 await page.keyboard.press('p');await page.waitForFunction(()=>lanternVale.state.cameraMode==='photo');await page.keyboard.press('Escape');check('Escape exits photo into paused chase',await page.evaluate(()=>!lanternVale.state.active&&lanternVale.state.cameraMode==='chase'));
 await page.evaluate(()=>lanternVale.reset());await page.waitForFunction(()=>lanternVale.state.active);await page.evaluate(()=>lanternVale.pause());await page.waitForTimeout(150);
 check('Reset preserves preferences',await page.evaluate(()=>document.getElementById('mute').checked&&document.getElementById('volume').value==='0.6'&&document.getElementById('nukeYield').value==='local'));
 await page.evaluate(()=>{lanternVale.setQuality('1080');lanternVale.inspect([1010,160,850],[1210,30,1080]);});await page.waitForTimeout(500);await page.evaluate(()=>document.querySelector('#overlay').hidden=true);await page.screenshot({path:'checks/polish/castle.png'});
 await page.evaluate(()=>{lanternVale.blast(lanternVale.world.castle,'castle');});await page.evaluate(()=>lanternVale.step(240));await page.waitForTimeout(400);await page.screenshot({path:'checks/polish/ruins.png'});
 await page.evaluate(()=>lanternVale.save());await page.reload();await ready();check('Ruined world restores without recovery',await page.evaluate(()=>lanternVale.state.snapshot.stats.removed>0&&!document.getElementById('recovery').open));
 check('No page errors',errors.length===0,errors);check('No WebGL error',await page.evaluate(()=>lanternVale.renderer.getContext().getError()===0));
 fs.writeFileSync('checks/polish/browser-report.json',JSON.stringify({browser:await browser.version(),checks},null,2));if(checks.some(c=>!c.passed))process.exitCode=1;
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
