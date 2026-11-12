// Dev tool: render fixed views of the running game (software GPU OK).
// Usage: NODE_PATH=/opt/node22/lib/node_modules node tools/probe.js "http://127.0.0.1:8765/game/?qa=1&q=medium" /path/out.png '[{"x":0,"z":24,"yaw":0,"pitch":-0.04,"ads":0}]'
// Writes out_0.png, out_1.png ... Optional per-camera flags: norain, nosplash, nofx.
const { chromium } = require('playwright');
(async()=>{
 const [url,out,cams]=process.argv.slice(2);
 const b=await chromium.launch({args:['--enable-webgl','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
 const p=await b.newPage({viewport:{width:1280,height:720}});
 p.setDefaultTimeout(600000);
 p.on('console',m=>{ if(['error','warning'].includes(m.type())) console.log('CONSOLE',m.type(),m.text().slice(0,400));});
 p.on('pageerror',e=>console.log('PAGEERROR',String(e).slice(0,600)));
 const t0=Date.now();
 await p.goto(url);
 await p.waitForFunction('!document.getElementById("startBtn").disabled || document.getElementById("menuNote").textContent.includes("Kunde")',null,{timeout:300000});
 console.log('loaded in',(Date.now()-t0)/1000,'s');
 await p.evaluate(()=>window.__TIDAL_QA__.hold(true));
 await p.click('#startBtn');
 const list=JSON.parse(cams);
 for (const [i,c] of list.entries()){
  const ms=await p.evaluate(c=>{const Q=window.__TIDAL_QA__;Q.freeze(true);Q.view(c.x,c.z,c.yaw,c.pitch);Q.ads(c.ads||0); if(c.norain!==undefined){Q.layer("rain",!c.norain);Q.layer("splashes",!c.nosplash);Q.fx(!c.nofx);}Q.renderFrame(10);return Q.renderFrame(10.02);},c);
  await p.screenshot({path:out.replace('.png',`_${i}.png`)});
  console.log('frame ms',ms.toFixed(0), JSON.stringify(await p.evaluate(()=>window.__TIDAL_QA__.perf())));
 }
 await b.close();
})();
