// Run with NODE_PATH pointing at a Playwright installation. No web server is used.
const {chromium}=require('playwright');
const fs=require('fs'),path=require('path'),{pathToFileURL}=require('url');
const root=path.resolve(__dirname,'..');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist']});
 const page=await browser.newPage({viewport:{width:1440,height:900},offline:true});const errors=[],network=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});page.on('request',r=>{if(/^https?:/.test(r.url()))network.push(r.url())});
 await page.goto(pathToFileURL(path.join(root,'index.html')).href+'#debug');await page.waitForTimeout(500);
 if(await page.locator('#fatal').isVisible())throw Error(await page.locator('#fatalDetail').textContent());
 const report={browser:await browser.version(),tests:[],views:[]};
 report.tests=await page.evaluate(()=>{
  const w=lanternVale,d=w.data,out=[];function check(name,ok,detail){out.push({name,passed:!!ok,detail})}
  let same=true;for(let [x,z] of [[0,0],[256,256],[200,170],[512,512]])if(Math.abs(d.heights[z*513+x]-w.rawHeight(x,z))>.00001)same=false;check('Terrain seed and samples are deterministic',same);
  let tri=true;for(let x=20;x<490;x+=37)for(let z=20;z<490;z+=31){let u=.27,v=.31,i=z*513+x,h=d.heights[i]+(d.heights[i+1]-d.heights[i])*u+(d.heights[i+513]-d.heights[i])*v;if(Math.abs(w.terrain(x+u,z+v)-h)>1e-5)tri=false}check('CPU terrain uses exact triangle interpolation',tri);
  let covered=true;d.objects.forEach((o,i)=>{for(let z=Math.max(0,Math.floor(o.minZ/8));z<=Math.min(63,Math.floor(o.maxZ/8));z++)for(let x=Math.max(0,Math.floor(o.minX/8));x<=Math.min(63,Math.floor(o.maxX/8));x++)if(!d.cellLists[z*64+x].includes(i))covered=false});check('Spatial grid covers every overlapping primitive',covered);
  check('Collision grid has bounded object density',Math.max(...d.cellLists.map(l=>l.length))<=256,{max:Math.max(...d.cellLists.map(l=>l.length))});
  w.setView(350,275,0,0);w.setKeys(['KeyW']);for(let i=0;i<120;i++)w.simulate(1/120);let straight=Math.hypot(w.state.player.x-350,w.state.player.z-275);
  w.setView(350,275,0,0);w.setKeys(['KeyW','KeyD']);for(let i=0;i<120;i++)w.simulate(1/120);let diag=Math.hypot(w.state.player.x-350,w.state.player.z-275);check('Diagonal speed equals straight speed',Math.abs(diag-straight)<.001,{straight,diag});
  w.setView(350,275,0,0);w.setKeys([]);w.jump();let base=w.state.player.y,peak=base;for(let i=0;i<240;i++){w.simulate(1/120);peak=Math.max(peak,w.state.player.y)}check('Jump reaches target height and lands',peak-base>.72&&peak-base<.84&&Math.abs(w.state.player.y-base)<.01,{height:peak-base});
  w.setView(350,297,0,0);w.setKeys(['KeyW','ShiftLeft']);for(let i=0;i<600;i++)w.simulate(1/120);check('Fort wall blocks sprinting',w.state.player.z<306.2,{z:w.state.player.z});
  w.setView(350,235,0,0);w.setKeys(['KeyW']);for(let i=0;i<600;i++)w.simulate(1/120);check('Fort arch is traversable',w.state.player.z>250,{z:w.state.player.z});
  let bx=w.riverX(220);w.setView(bx-35,220,Math.PI/2,0);w.setKeys(['KeyW','ShiftLeft']);for(let i=0;i<1250;i++)w.simulate(1/120);check('Bridge can be crossed on foot',w.state.player.x>bx+34&&w.state.player.y>1.9,{player:w.state.player});
  w.setView(220,220,Math.PI,0);w.setKeys(['KeyW']);for(let i=0;i<1200;i++)w.simulate(1/120);check('Bridge-side bank can be climbed back toward the river path',w.state.player.z<186,{player:w.state.player});
  let rx=w.riverX(180);w.setView(rx,180,Math.PI/2,0,-1.05);w.setKeys([]);for(let i=0;i<30;i++)w.simulate(1/120);check('Deep water enters surface swimming',w.state.player.swimming&&Math.abs(w.state.player.y+1.05)<.02);
  w.setKeys(['KeyW']);for(let i=0;i<2000;i++)w.simulate(1/120);check('Swimmer can exit onto a bank',!w.state.player.swimming&&w.state.player.y>.2,{player:w.state.player});
  w.setView(2.1,200,-Math.PI/2,0);w.setKeys(['KeyW','ShiftLeft']);for(let i=0;i<1200;i++)w.simulate(1/120);check('Map boundary contains the player',w.state.player.x>=2);
  w.setKeys([]);w.setView(350,275,0,-1.3);w.setDiagnostic(1);w.render();let pix=w.readCell(Math.floor(w.state.columns/2),Math.floor(w.state.rows/2));check('Center pixel displays the courtyard terrain material',Math.abs(pix[0]-197)<12&&Math.abs(pix[1]-81)<12,{pixel:pix});w.setDiagnostic(0);
  check('WebGL reports no error',w.getError()===0);w.reset();return out;
 });
 console.log(JSON.stringify(report.tests,null,2));
 await page.screenshot({path:path.join(__dirname,'entry.png')});
 await page.locator('#enter').click();await page.waitForTimeout(500);report.tests.push({name:'Enter hides overlay and activates movement',passed:await page.evaluate(()=>lanternVale.state.active&&document.querySelector('#overlay').hidden)});
 const views=[['river',()=>{let x=lanternVale.riverX(185);lanternVale.setView(x-23,185,1.35,-.07)},15.5],['fort',()=>lanternVale.setView(350,223,0,.10),12],['forest',()=>lanternVale.setView(175,279,.25,.04),12],['ridge',()=>lanternVale.setView(365,425,3.12,-.22),15],['sunset',()=>lanternVale.setView(350,223,0,.12),18.2],['night',()=>lanternVale.setView(350,231,0,.10),22]];
 for(const [name,setup,time] of views){await page.evaluate(setup);await page.evaluate(h=>{lanternVale.setHour(h);lanternVale.setQuality(1080);document.querySelector('#holdTime').checked=true;document.querySelector('#holdTime').dispatchEvent(new Event('change'))},time);await page.waitForTimeout(1800);let stats=await page.evaluate(()=>({...lanternVale.state,avgFPS:1000/lanternVale.state.avgMS}));report.views.push({name,fps:stats.avgFPS,position:stats.player});await page.screenshot({path:path.join(__dirname,name+'.png')});}
 await page.keyboard.press('Escape');report.tests.push({name:'Escape opens pause menu',passed:await page.locator('#overlay').isVisible()});
 await page.setViewportSize({width:900,height:600});await page.waitForTimeout(200);report.tests.push({name:'Resize keeps framebuffer valid',passed:await page.evaluate(()=>lanternVale.getError()===0&&lanternVale.state.resourcesValid)});
 report.tests.push({name:'Offline file launch makes no network requests',passed:network.length===0});report.errors=errors;report.network=network;
 fs.writeFileSync(path.join(__dirname,'report.json'),JSON.stringify(report,null,2));console.log('REPORT',JSON.stringify(report,null,2));await browser.close();if(report.tests.some(t=>!t.passed)||errors.length)process.exitCode=1;
})().catch(e=>{console.error(e);process.exit(1)});
