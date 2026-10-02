"""Run against Vite on port 5177; uses a disposable browser profile.

GPU rendering is exercised for flight and destruction. Timing/lifecycle checks
then disable GPU drawing to isolate the main loop on headless software graphics.
These measurements are not estimates of hardware GPU performance.
"""
import json
import re
from pathlib import Path
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, args=['--enable-unsafe-swiftshader'])
    page = browser.new_page(viewport={'width': 960, 'height': 600})
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto('http://127.0.0.1:5177/#debug')
    page.wait_for_function('window.lanternVale?.state.ready', timeout=60000)
    page.locator('#showPerf').check()
    page.locator('#quality').select_option('720')
    page.evaluate('''async () => {
      const { GameRenderer } = await import('/src/render/renderer.ts');
      window.flightCheck = {view:null, frames:[], rendered:0, phase:'flight'};
      const render = GameRenderer.prototype.render;
      GameRenderer.prototype.render = function(dt,active,frameTime) {
        flightCheck.view=this;
        if(active && flightCheck.waitingForReset) {
          flightCheck.resetSamples=lanternVale.samples.slice();
          flightCheck.waitingForReset=false;
        }
        const at=performance.now();
        const result=render.call(this,dt,active,frameTime);
        if(active) flightCheck.frames.push({at,phase:flightCheck.phase,z:this.jet.position.z});
        flightCheck.rendered++;
        return result;
      };
    }''')
    page.locator('#enter').click()
    page.wait_for_function('flightCheck.view && flightCheck.frames.length >= 3', timeout=60000)
    page.evaluate('''() => {
      const view=flightCheck.view;
      flightCheck.gpuRender=view.renderer.render;
      view.renderer.render=()=>{};
      lanternVale.setPlane([1000,450,400],0,0);
      lanternVale.controls({x:0,y:0,throttle:0,bank:0,boost:false,fire:false});
    }''')
    page.wait_for_function('lanternVale.samples.length >= 130', timeout=15000)
    page.wait_for_function('/1% low [0-9.]+ FPS/.test(document.getElementById("perf").textContent)', timeout=5000)
    page.evaluate('''() => {
      const until=performance.now()+180;
      while(performance.now()<until) {}
    }''')
    page.wait_for_function('''() => {
      const m=document.getElementById('perf').textContent.match(/worst ([0-9.]+) ms/);
      return m && Number(m[1]) >= 150;
    }''', timeout=5000)
    stalled = page.locator('#perf').inner_text()
    assert float(re.search(r'worst ([0-9.]+) ms', stalled)[1]) >= 150
    page.keyboard.press('p')
    page.wait_for_function('lanternVale.state.cameraMode === "photo"')
    page.keyboard.press('p')
    page.wait_for_function('lanternVale.state.active && lanternVale.samples.length < 100', timeout=3000)
    page.wait_for_function('document.getElementById("perf").textContent.includes("1% low warming up")', timeout=2000)
    page.evaluate('lanternVale.pause()')
    page.locator('#quality').select_option('1080')
    assert page.evaluate('lanternVale.samples.length') == 0
    page.locator('#enter').click()
    page.wait_for_function('lanternVale.samples.length >= 100', timeout=10000)
    page.evaluate('''() => {
      flightCheck.phase='destruction';
      lanternVale.blast(lanternVale.world.castle,'valley');
    }''')
    page.wait_for_function('lanternVale.state.snapshot.stats.removed > 50', timeout=15000)
    page.wait_for_function('flightCheck.frames.filter(f=>f.phase==="destruction").length >= 180', timeout=10000)
    page.evaluate('''() => {
      flightCheck.phase='gpu-destruction';
      flightCheck.view.renderer.render=flightCheck.gpuRender;
    }''')
    page.wait_for_function('flightCheck.frames.filter(f=>f.phase==="gpu-destruction").length >= 3', timeout=30000)
    page.screenshot(path='/tmp/pineapple-flight-browser.png')
    page.evaluate('''() => {
      flightCheck.view.renderer.render=()=>{};
      lanternVale.pause();
    }''')
    damaged_before = page.evaluate('lanternVale.state.snapshot.stats.removed')
    assert damaged_before > 50
    page.locator('.settings-graphics #renderDistance').press('Home')
    page.locator('.settings-graphics #renderDistance').press('End')
    assert page.evaluate('lanternVale.state.snapshot.stats.removed') >= damaged_before
    page.locator('#defaultSettings').click()
    assert page.evaluate('lanternVale.state.snapshot.stats.removed') >= damaged_before
    assert page.evaluate('lanternVale.state.render.renderDistance') == 1200
    page.locator('#showPerf').check()
    page.locator('#enter').click()
    assert page.evaluate('lanternVale.samples.length') < 100
    page.wait_for_function('lanternVale.samples.length >= 120', timeout=10000)
    page.evaluate('''async () => {
      lanternVale.pause();
      flightCheck.waitingForReset=true;
      await lanternVale.reset();
    }''')
    page.wait_for_function('flightCheck.resetSamples !== undefined', timeout=10000)
    assert page.evaluate('flightCheck.resetSamples') == [16.67]
    result = page.evaluate('''() => ({
      frames:flightCheck.frames, overlay:document.getElementById('perf').textContent,
      resetReady:lanternVale.state.ready, resetSamples:flightCheck.resetSamples,
      rendered:flightCheck.rendered
    })''')
    distance = page.locator('.settings-graphics #renderDistance')
    page.evaluate('lanternVale.pause()')
    assert distance.input_value() == '1200'

    def range_state():
        return page.evaluate('''() => {
          const view=flightCheck.view;
          return {distance:view.stats.renderDistance, far:view.camera.far,
            skyRadius:view.sky.geometry.parameters.radius*view.sky.scale.x,
            visibleInstances:view.batches.reduce((n,b)=>n+(b.mesh.visible?b.mesh.count:0)+(b.low?.visible?b.low.count:0),0)};
        }''')

    ranges = {}
    for key, value in [('Home', 600), ('End', 3000)]:
        distance.press(key)
        page.wait_for_function('(value) => lanternVale.state.render.renderDistance === value && flightCheck.view.lastLOD !== -Infinity', arg=value)
        ranges[str(value)] = range_state()
        assert ranges[str(value)]['skyRadius'] < ranges[str(value)]['far']
        target = page.evaluate('''() => {
          flightCheck.view.renderer.render=flightCheck.gpuRender;
          return flightCheck.rendered+3;
        }''')
        page.wait_for_function('(target) => flightCheck.rendered >= target', arg=target, timeout=30000)
        page.screenshot(path=f'/tmp/pineapple-render-distance-{value}.png')
        page.evaluate('flightCheck.view.renderer.render=()=>{}')
    assert ranges['3000']['visibleInstances'] > ranges['600']['visibleInstances'], ranges

    def wait_saved(value):
        page.wait_for_function('''async (value) => {
          const {SaveStore}=await import('/src/storage.ts');
          const store=new SaveStore();
          await store.open();
          try {return (await store.preferences())?.renderDistance === value;}
          finally {store.db.close();}
        }''', arg=value)

    wait_saved(3000)
    page.reload()
    page.wait_for_function('window.lanternVale?.state.ready', timeout=60000)
    assert distance.input_value() == '3000'
    assert page.evaluate('lanternVale.state.render.renderDistance') == 3000
    assert page.locator('#renderDistanceValue').inner_text() == '3,000 m'
    page.locator('#defaultSettings').click()
    assert distance.input_value() == '1200'
    assert page.evaluate('lanternVale.state.render.renderDistance') == 1200
    wait_saved(1200)
    page.reload()
    page.wait_for_function('window.lanternVale?.state.ready', timeout=60000)
    assert distance.input_value() == '1200'
    assert page.evaluate('lanternVale.state.render.renderDistance') == 1200
    page.locator('.settings-graphics').screenshot(path='/tmp/pineapple-render-distance-settings.png')
    result['render_distance_checks'] = {'ranges':ranges, 'reload':3000, 'defaults_reload':1200, 'retained_destroyed_objects':damaged_before}
    result.update(errors=errors, stalled_overlay=stalled,
                  gpu_note='Software WebGL; drawing disabled during timing/lifecycle isolation.')
    Path('/tmp/pineapple-flight-browser.json').write_text(json.dumps(result,indent=2))
    assert not errors, errors
    print(json.dumps({k:v for k,v in result.items() if k != 'frames'}),flush=True)
    browser.close()
