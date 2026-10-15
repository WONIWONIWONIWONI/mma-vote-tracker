/* Exercise public UI through actual browser input; no production votes are written. */
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'../dist');
const ids=['994944','3709231','3574243','3207401','672375','3478478'];
const names=['임영웅','RESCENE (리센느)','NCT WISH','PLAVE','방탄소년단','RIIZE'];
const bases=[100000,72000,65000,62000,38000,36000],rates=[20,50,10,9,5,4];
const time=Date.parse('2026-10-15T12:40:00Z');
function snapshot(i){const teams=ids.map((id,k)=>({id,name:names[k],votes:bases[k]+rates[k]*i}));const totalVotes=teams.reduce((s,t)=>s+t.votes,0);teams.forEach((t,k)=>{t.rank=k+1;t.reportedShare=Math.round(t.votes/totalVotes*100);});return {sourceAt:new Date(time+(i-720)*60000).toISOString(),origin:'melon_public_api',totalVotes,top4:teams};}
const history={schemaVersion:2,snapshots:Array.from({length:720},(_,i)=>snapshot(i)),historyCount:720};
const seed={...history,snapshots:history.snapshots.slice(-3)};
async function setup(browser,mobile=false){
 const context=await browser.newContext(mobile?{viewport:{width:390,height:844},isMobile:true,hasTouch:true}:{viewport:{width:1280,height:960}});
 const page=await context.newPage();await page.clock.install({time:new Date(time)});
 let liveCalls=0,archiveCalls=0,rawCalls=0,failLive=false,failAPI=false,releaseArchive;
 const gate=new Promise(resolve=>releaseArchive=resolve),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/*',async route=>{const u=new URL(route.request().url());
  if(u.hostname==='local.test'){
   if(u.pathname==='/data/seed.js')return route.fulfill({body:'window.MMA_SEED='+JSON.stringify(seed),contentType:'text/javascript'});
   return route.fulfill({path:path.join(root,u.pathname==='/'?'index.html':u.pathname)});
  }
  if(u.hostname==='m2.melon.com'){
   liveCalls++;if(failLive)return route.fulfill({status:503,body:'temporary error'});
   const s=snapshot(720+liveCalls);const nominees=s.top4.map(t=>({content:{id:t.id,name:t.name},voteCount:t.votes,votePercent:t.reportedShare}));
   return route.fulfill({headers:{'Access-Control-Allow-Origin':'*'},json:{response:{status:'ok',nominees}}});
  }
  if(u.hostname==='api.github.com'||u.hostname==='raw.githubusercontent.com'){
   if(u.hostname==='api.github.com'){archiveCalls++;if(failAPI)return route.fulfill({status:403,body:'rate limited'});}else rawCalls++;
   await gate;return route.fulfill({headers:{'Access-Control-Allow-Origin':'*'},json:u.pathname.endsWith('latest.json')?seed:history});
  }
  return route.abort();
 });
 await page.goto('https://local.test/');
 await page.waitForFunction(()=>window.MMA_DATA?.snapshots.at(-1).origin==='melon_browser_api');
 await page.waitForFunction(()=>!document.getElementById('refresh-button').disabled);
 assert.equal(archiveCalls,1);
 assert.equal(liveCalls,1);
 // A second live request is possible even while the first archival sync is blocked.
 await page.locator('#refresh-button').click();await page.waitForFunction(()=>!document.getElementById('refresh-button').disabled);
 assert.equal(liveCalls,2);assert.equal(archiveCalls,1,'do not duplicate an archive request in flight');
 releaseArchive();await page.waitForFunction(()=>window.MMA_DATA.snapshots.length>700);
 const liveBefore=liveCalls,archivesBefore=archiveCalls;
 await page.clock.fastForward(65000);
 assert.equal(liveCalls,liveBefore,'no automatic Melon polling');assert.equal(archiveCalls,archivesBefore,'no automatic archive polling');
 const colors=await page.locator('.leader').evaluateAll(rows=>rows.map(e=>e.style.getPropertyValue('--color')));
 assert.equal(new Set(colors).size,6,'all six teams have distinct colors');assert.equal(colors[1],'#e6ff54');
 await page.locator('#trend-chart').scrollIntoViewIfNeeded();await page.locator('#trend-forecast').uncheck();await page.locator('#trend-zoom').selectOption('8');
 async function focused(){const s=await page.evaluate(()=>window.MMA_DATA.snapshots.at(-1));const metric=await page.locator('[data-metric].selected').getAttribute('data-metric');const t=s.top4.find(t=>t.id===ids[1]);const v=metric==='share'?t.votes/s.totalVotes*100:t.votes;const bounds=await page.locator('#trend-chart').evaluate(e=>[+e.dataset.ymin,+e.dataset.ymax]);assert.ok(v>=bounds[0]&&v<=bounds[1],`focus includes Rescene: ${v} in ${bounds}`);return bounds;}
 const bounds=await focused();
 if(!mobile){const r=await page.locator('#trend-chart').boundingBox();await page.mouse.move(r.x+r.width*.55,r.y+r.height*.5);await page.mouse.down();await page.mouse.move(r.x+r.width*.55,r.y+r.height*.5+70,{steps:8});await page.mouse.up();assert.notEqual((await focusedBounds(page))[0],bounds[0],'mouse pans the vertical viewport');}
 await page.locator('#trend-time-zoom').selectOption('4');await page.locator('#trend-chart').scrollIntoViewIfNeeded();
 const timeBounds=()=>page.locator('#trend-chart').evaluate(e=>[+e.dataset.xmin,+e.dataset.xmax]);
 const oldTime=await timeBounds(),oldY=await focusedBounds(page),tr=await page.locator('#trend-chart').boundingBox();
 const tx=tr.x+tr.width*.55,ty=tr.y+tr.height*.5;
 if(mobile){const cdp=await context.newCDPSession(page);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:tx,y:ty}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:tx+65,y:ty+30}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}
 else{await page.mouse.move(tx,ty);await page.mouse.down();await page.mouse.move(tx+90,ty+30,{steps:10});await page.mouse.up();}
 const movedTime=await timeBounds();assert.ok(movedTime[0]<oldTime[0],'main chart drags horizontally toward earlier times');assert.ok(Math.abs((movedTime[1]-movedTime[0])-(oldTime[1]-oldTime[0]))<1,'panning preserves horizontal zoom');assert.notEqual((await focusedBounds(page))[0],oldY[0],'diagonal drag moves both axes');
 await page.locator('#trend-right').click();assert.ok((await timeBounds())[0]>movedTime[0],'main chart can move back toward later times');
 await page.locator('[data-metric="share"]').click();await focused();await page.locator('[data-range="0.25"]').click();await focused();
 await page.locator('#trend-focus').selectOption(ids[1]);await page.locator('#trend-chart').scrollIntoViewIfNeeded();
 if(mobile){const r=await page.locator('#trend-chart').boundingBox(),cdp=await context.newCDPSession(page);const old=await focusedBounds(page);const x=r.x+r.width*.55,y=r.y+r.height*.5;
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y+50}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});assert.notEqual((await focusedBounds(page))[0],old[0],'touch pans the vertical viewport');
 }
 console.log('Candle zoom before',await page.locator('#cd-svg').evaluate(e=>({start:e.dataset.start,count:e.dataset.count,total:e.dataset.total,zoomIn:document.querySelector('#cd-zoom-in').disabled})));
 await page.locator('#cd-zoom-in').click();await page.locator('#cd-zoom-in').click();await page.locator('#cd-svg').scrollIntoViewIfNeeded();
 const view=()=>page.locator('#cd-svg').evaluate(e=>({start:+e.dataset.start,n:+e.dataset.count,total:+e.dataset.total,W:e.viewBox.baseVal.width}));
 const before=await view();assert.ok(before.n<before.total);
 if(!mobile){
  const r=await page.locator('#cd-svg').boundingBox();const left=62,ratio=.72,x=r.x+(left+(before.W-left-8)*ratio)*r.width/before.W,y=r.y+r.height*.5;
  await page.mouse.move(x,y);await page.keyboard.down('Control');await page.mouse.wheel(0,-100);await page.keyboard.up('Control');
  await page.waitForFunction(n=>+document.querySelector('#cd-svg').dataset.count<n,before.n);
  const zoomed=await view();assert.ok(Math.abs((before.start+ratio*before.n)-(zoomed.start+ratio*zoomed.n))<1.1,'wheel keeps the candle under the cursor');
  const box=await page.locator('#cd-svg').boundingBox();await page.mouse.move(box.x+box.width*.5,box.y+box.height*.5);await page.mouse.down();await page.mouse.move(box.x+box.width*.5+100,box.y+box.height*.5,{steps:10});await page.mouse.up();assert.ok((await view()).start<zoomed.start,'mouse drag moves toward older candles');
 }else{
  const cdp=await context.newCDPSession(page),r=await page.locator('#cd-svg').boundingBox(),x=r.x+r.width*.55,y=r.y+r.height*.5;
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:x-35,y},{x:x+35,y}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x-50,y},{x:x+50,y}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x-60,y},{x:x+60,y}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});const zoomed=await view();assert.ok(zoomed.n<before.n,'pinch zooms');
  const ratio=(x-r.x-44)/(r.width-44-8);assert.ok(Math.abs(before.start+ratio*before.n-zoomed.start-ratio*zoomed.n)<1.5,'pinch keeps its original anchor across multiple moves');
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+70,y}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});assert.ok((await view()).start<zoomed.start,'touch drag moves toward older candles');
 }
 await page.locator('#cd-reset').click();const full=await view();assert.equal(full.n,full.total);assert.equal(full.start,0);
 // A GitHub API limit falls back to raw; a failed live fetch preserves the last observation.
 failLive=true;failAPI=true;const stamp=await page.evaluate(()=>window.MMA_DATA.snapshots.at(-1).sourceAt);
 const rawResponse=page.waitForResponse(r=>new URL(r.url()).hostname==='raw.githubusercontent.com');
 await page.locator('#refresh-button').click();await rawResponse;await page.waitForFunction(()=>document.getElementById('status-label').textContent==='직접 조회 실패');
 await page.waitForFunction(()=>!document.getElementById('refresh-button').disabled);assert.equal(await page.evaluate(()=>window.MMA_DATA.snapshots.at(-1).sourceAt),stamp);
 await page.waitForFunction(()=>document.getElementById('notice-text').textContent.includes('직접 조회에 실패'));assert.ok(rawCalls>0,'rate limited API falls back to raw');
 if(!mobile){
  await page.locator('#gap-pair').selectOption(ids[0]);
  for(const [first,last,label,color] of [[-100,-50,'격차 축소','#ff4757'],[100,150,'격차 확대','#ff4757'],[-100,-150,'격차 확대','#4fc8e0'],[100,50,'격차 축소','#4fc8e0']]){
   const rows=Array.from({length:7},(_,i)=>{const s=snapshot(714+i),gap=first+(last-first)*i/6;s.top4[1].votes=100000+i*10;s.top4[0].votes=s.top4[1].votes-gap;s.top4.sort((a,b)=>b.votes-a.votes);s.totalVotes=s.top4.reduce((n,t)=>n+t.votes,0);s.top4.forEach((t,i)=>{t.rank=i+1;t.reportedShare=Math.round(t.votes/s.totalVotes*100);});return s;});
   await page.evaluate(data=>window.dispatchEvent(new CustomEvent('mma:data',{detail:data})),{...history,snapshots:rows});
   const metric=page.locator('.pc-metric').first();assert.ok((await metric.textContent()).includes(label));assert.equal(await metric.locator('strong').evaluate(e=>getComputedStyle(e).color),color==='#ff4757'?'rgb(255, 120, 154)':'rgb(79, 200, 224)');
  }
 }
 assert.deepEqual(errors,[]);fs.mkdirSync('qa-output',{recursive:true});await page.screenshot({path:`qa-output/${mobile?'mobile':'desktop'}.png`,fullPage:true});
 console.log(`${mobile?'Mobile':'Desktop'}: direct refresh, slow archive, no polling, colors, focused zoom, two-axis main-chart drag, cursor/pinch anchor, fallback and signed gap colors passed.`);
 await context.close();
}
async function focusedBounds(page){return page.locator('#trend-chart').evaluate(e=>[+e.dataset.ymin,+e.dataset.ymax]);}
(async()=>{const browser=await chromium.launch({headless:true});try{await setup(browser);await setup(browser,true);}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
