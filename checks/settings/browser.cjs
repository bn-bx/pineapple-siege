const {chromium}=require('playwright'),fs=require('fs');
(async()=>{
 const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist']});
 const checks=[],errors=[];
 const check=(name,passed,detail)=>{checks.push({name,passed:!!passed,detail});console.log(JSON.stringify(checks.at(-1)));};
 try {
 const page=await browser.newPage({viewport:{width:1440,height:900}});page.on('pageerror',e=>errors.push(e.message));
 const ready=()=>page.waitForFunction(()=>window.lanternVale?.state.ready,null,{timeout:120000});
 await page.goto('http://127.0.0.1:4173/#debug');await ready();
 await page.evaluate(()=>document.getElementById('perf').hidden=true);
 const layout=await page.evaluate(()=>({sections:[...document.querySelectorAll('#settings section')].map(e=>({name:e.querySelector('h3').textContent,visible:e.getBoundingClientRect().bottom<=innerHeight})),accordion:document.querySelectorAll('#settings details').length,width:document.querySelector('#overlay').getBoundingClientRect().width,overflow:document.querySelector('#overlay').scrollWidth>innerWidth}));
 check('Fullscreen menu, all sections visible at 1440×900, no accordions or horizontal overflow',layout.sections.length===5&&layout.sections.every(x=>x.visible)&&!layout.accordion&&layout.width===1440&&!layout.overflow,layout);
 await page.screenshot({path:'checks/settings/fullscreen.png'});
 await page.evaluate(()=>lanternVale.blast(lanternVale.world.castle));await page.evaluate(()=>lanternVale.step(120));
 const before=await page.evaluate(()=>lanternVale.snapshot());
 for(const id of ['mute','reduceEffects','reduceShake','holdTime','showPerf','reverseX','invert','noCooldown']) await page.locator('#'+id).check();
 for(const [id,value] of Object.entries({volume:'.8',sensitivity:'2',bodies:'3',fragments:'3',cosmetics:'3',rubble:'3',nukeScale:'2',time:'3'}))await page.locator('#'+id).evaluate((e,v)=>{e.value=v;e.dispatchEvent(new Event('input'));},value);
 await page.locator('#quality').selectOption('720');await page.locator('#nukeYield').selectOption('local');
 await page.locator('#defaultSettings').click();await page.waitForTimeout(400);
 const defaults=()=>page.evaluate(()=>({checks:['mute','reduceEffects','reduceShake','holdTime','showPerf','reverseX','invert','noCooldown'].every(id=>!document.getElementById(id).checked),values:Object.fromEntries(['quality','nukeYield','volume','sensitivity','bodies','fragments','cosmetics','rubble','nukeScale'].map(id=>[id,document.getElementById(id).value]))}));
 const expected={quality:'auto',nukeYield:'valley',volume:'0.35',sensitivity:'1',bodies:'1',fragments:'1',cosmetics:'1',rubble:'1',nukeScale:'1'};
 let result=await defaults();check('Reset restores all preferences',result.checks&&JSON.stringify(result.values)===JSON.stringify(expected),result);
 const after=await page.evaluate(()=>lanternVale.snapshot());
 const permanent=s=>JSON.stringify(Object.fromEntries(Object.entries(s).filter(([k])=>!['hour'].includes(k))));
 check('Reset preserves all damaged world state and resets afternoon time',before.removed.length>0&&permanent(before)===permanent(after)&&after.hour===15.5,{removed:after.removed.length,hour:after.hour,keys:Object.keys(after)});
 await page.evaluate(()=>lanternVale.save());await page.reload();await ready();result=await defaults();
 check('Defaults persist after reload',result.checks&&JSON.stringify(result.values)===JSON.stringify(expected),result);
 check('Destroyed world survives reload',await page.evaluate(()=>lanternVale.state.snapshot.stats.removed>0));
 await page.setViewportSize({width:900,height:700});await page.screenshot({path:'checks/settings/compact.png'});
 check('Compact menu scrolls without horizontal overflow',await page.evaluate(()=>{const e=document.getElementById('overlay');return e.scrollWidth<=innerWidth&&e.scrollHeight>e.clientHeight;}));
 await page.locator('#reset').click();check('World reset retains confirmation',await page.locator('#confirm').evaluate(e=>e.open));await page.locator('#cancelReset').click();
 await page.locator('#enter').click();await page.waitForTimeout(250);await page.evaluate(()=>lanternVale.pause());
 check('Pause opens all settings without expansion',await page.locator('#overlay').isVisible()&&await page.locator('#title').textContent()==='Paused'&&await page.locator('#settings details').count()===0);
 check('No browser errors',errors.length===0,errors);
 fs.writeFileSync('checks/settings/report.json',JSON.stringify({browser:await browser.version(),checks},null,2));if(checks.some(x=>!x.passed))process.exitCode=1;
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
