const { chromium } = require('playwright');
const fs = require('fs');
(async()=>{
 const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist']});
 const checks=[],errors=[];
 try {
 const page=await browser.newPage({viewport:{width:1280,height:720}});
 page.on('pageerror',e=>errors.push(e.message));
 const check=(name,passed,detail)=>{const c={name,passed:!!passed,detail};checks.push(c);console.log(JSON.stringify(c));};
 const ready=()=>page.waitForFunction(()=>window.lanternVale?.state.ready,null,{timeout:120000});
 await page.goto('http://127.0.0.1:4173/#debug');await ready();
 await page.evaluate(()=>document.querySelectorAll('details').forEach(e=>e.open=true));
 await page.locator('#noCooldown').check();await page.waitForTimeout(350);
 await page.reload();await ready();
 check('All-weapon preference survives reload',await page.locator('#noCooldown').isChecked());
 await page.evaluate(()=>lanternVale.reset());await page.waitForFunction(()=>lanternVale.state.active);await page.evaluate(()=>lanternVale.pause());await page.waitForTimeout(300);
 check('World reset preserves setting',(await page.evaluate(()=>lanternVale.snapshot())).destruction.noCooldown);
 for(const weapon of ['nuke','cannon']){
 const before=await page.evaluate(()=>lanternVale.state.snapshot.stats.shots);
 await page.evaluate(async weapon=>{lanternVale.setPlane([1024,400,650],0,0);lanternVale.send({type:'weapon',weapon});lanternVale.send({type:'input',input:{x:0,y:0,throttle:0,bank:0,boost:false,fire:true}});await lanternVale.step(60);},weapon);
 await page.waitForTimeout(250);
 const s=await page.evaluate(()=>lanternVale.state);
 check(weapon+' launches 60 shots in 60 ticks',s.snapshot.stats.shots-before===60&&s.snapshot.cooldowns[weapon]===0,{shots:s.snapshot.stats.shots-before,live:s.snapshot.projectiles.length,cooldowns:s.snapshot.cooldowns});
 check(weapon+' renders every live projectile',s.render.projectiles===s.snapshot.projectiles.length&&s.render.projectiles>12,{rendered:s.render.projectiles,live:s.snapshot.projectiles.length});
 }
 await page.evaluate(()=>document.querySelectorAll('details').forEach(e=>e.open=true));await page.locator('#noCooldown').uncheck();
 await page.evaluate(()=>lanternVale.reset());await page.waitForFunction(()=>lanternVale.state.active);await page.evaluate(()=>lanternVale.pause());await page.waitForTimeout(300);
 for(const weapon of ['cannon','nuke']){
 const before=await page.evaluate(()=>lanternVale.state.snapshot.stats.shots);
 await page.evaluate(async weapon=>{lanternVale.setPlane([1024,400,650],0,0);lanternVale.send({type:'weapon',weapon});lanternVale.send({type:'input',input:{x:0,y:0,throttle:0,bank:0,boost:false,fire:true}});await lanternVale.step(30);},weapon);
 const s=await page.evaluate(()=>lanternVale.state.snapshot);
 check(weapon+' restores normal cooldown',s.stats.shots-before===1&&s.cooldowns[weapon]>0,{shots:s.stats.shots-before,cooldown:s.cooldowns[weapon]});
 }
 check('No browser errors',errors.length===0,errors);
 check('No WebGL errors',await page.evaluate(()=>lanternVale.renderer.getContext().getError()===0));
 fs.writeFileSync('checks/no-cooldown/report.json',JSON.stringify({browser:await browser.version(),checks},null,2));
 if(checks.some(c=>!c.passed))process.exitCode=1;
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
