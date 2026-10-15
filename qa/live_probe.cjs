const assert=require('node:assert/strict'),fs=require('node:fs');
const {chromium}=require('playwright');
(async()=>{const browser=await chromium.launch({headless:true});try{
 const page=await browser.newPage({viewport:{width:1280,height:960}});
 const url=process.env.SITE_URL||'https://woniwoniwoniwoni.github.io/mma-vote-tracker/';
 let ready=false;
 for(let attempt=0;attempt<5;attempt++){
  await page.goto(url+'?verify='+encodeURIComponent(process.env.GITHUB_SHA||Date.now())+'&attempt='+attempt,{waitUntil:'domcontentloaded'});
  try{await page.locator('#cd-zoom-in').waitFor({timeout:8000});ready=true;break;}catch{}
 }
 assert.ok(ready,'new chart controls are present on the deployed site');
 await page.waitForFunction(()=>window.MMA_DATA?.snapshots.at(-1).origin==='melon_browser_api',{},{timeout:20000});
 const data=await page.evaluate(()=>{const last=window.MMA_DATA.snapshots.at(-1);return {at:last.sourceAt,origin:last.origin,teams:last.top4.map(t=>({name:t.name,votes:t.votes})),colors:[...document.querySelectorAll('.leader')].map(e=>e.style.getPropertyValue('--color'))};});
 assert.ok(Math.abs(Date.now()-Date.parse(data.at))<90000);assert.equal(data.teams.length,6);assert.equal(new Set(data.colors).size,6);
 await page.waitForFunction(()=>!document.getElementById('refresh-button').disabled);
 await page.locator('#refresh-button').click();await page.waitForFunction(()=>!document.getElementById('refresh-button').disabled);
 assert.equal(await page.locator('#status-label').textContent(),'멜론 직접 조회');
 assert.equal(await page.locator('[data-range].selected').getAttribute('data-range'),'24');await page.locator('[data-range="1"]').click();await page.locator('.axis-options summary').click();await page.locator('#trend-zoom').selectOption('4');await page.locator('#trend-chart').scrollIntoViewIfNeeded();
 const before=await page.locator('#trend-chart').getAttribute('data-ymin'),r=await page.locator('#trend-chart').boundingBox();
 await page.mouse.move(r.x+r.width*.6,r.y+r.height*.5);await page.mouse.down();await page.mouse.move(r.x+r.width*.6,r.y+r.height*.5+60,{steps:8});await page.mouse.up();
 assert.notEqual(await page.locator('#trend-chart').getAttribute('data-ymin'),before,'deployed vertical drag works');
 await page.locator('#trend-time-zoom').selectOption('4');await page.locator('#trend-chart').scrollIntoViewIfNeeded();
 const oldTime=await page.locator('#trend-chart').getAttribute('data-xmin'),t=await page.locator('#trend-chart').boundingBox();
 await page.mouse.move(t.x+t.width*.6,t.y+t.height*.5);await page.mouse.down();await page.mouse.move(t.x+t.width*.6+80,t.y+t.height*.5,{steps:8});await page.mouse.up();
 assert.notEqual(await page.locator('#trend-chart').getAttribute('data-xmin'),oldTime,'deployed horizontal drag works');
 await page.locator('#trend-forecast-minutes').selectOption('180');assert.ok((await page.locator('#chart-note').textContent()).includes('180분'));
 fs.mkdirSync('qa-output',{recursive:true});await page.screenshot({path:'qa-output/live-desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'qa-output/live-mobile.png',fullPage:true});
 console.log('Live site verified:',JSON.stringify(data));
}finally{await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
