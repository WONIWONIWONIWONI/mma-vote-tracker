/* Pair-only seasonal projection and genuinely past-only replay. */
(()=>{
'use strict';
const root=document.getElementById('candle-panel');if(!root)return;
const nf=new Intl.NumberFormat('ko-KR'),fmt=v=>nf.format(Math.round(v)),signed=v=>(v>0?'+':v<0?'−':'')+fmt(Math.abs(v)),date=t=>new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(t),KEY='mma-gap-forecasts-twice-daily-v1';
let lastDue=MMAGapModel.scheduledCutoff(),dueTimer;
let data=window.MMA_DATA||window.MMA_SEED,choice='live',saved=[],active=null,cacheKey='',cacheModel=null;
try{const read=JSON.parse(localStorage.getItem(KEY)||'[]');if(Array.isArray(read))saved=read.filter(m=>m.version===MMAGapModel.VERSION&&Number.isFinite(m.cutoff)&&Number.isFinite(m.origin)&&Number.isFinite(m.gap)&&Array.isArray(m.path)&&m.path.length===289&&m.path.every((p,i)=>Number.isFinite(p.g)&&p.t===m.origin+i*300000)).slice(-72);}catch{}
const section=document.createElement('section');section.className='gap-future';section.setAttribute('aria-labelledby','gap-future-title');section.innerHTML=`<div class="gf-heading"><div><div class="section-kicker">NEXT 24 HOURS · RESCENE − 임영웅</div><h3 id="gap-future-title">시간대 패턴으로 보는 24시간 표차 예측</h3></div><label>예측 기준<select id="gf-origin" class="control-select" aria-label="표차 예측 기준 시점"></select></label></div><p class="gf-intro">한국 시간 매일 00시·12시 기준으로 하루 두 번 갱신합니다. 양수는 리센느 우세, 음수는 임영웅 우세입니다. 점선은 조건부 예측, 청록 실선은 실제 관측입니다.</p><div id="gf-content"></div><details class="gf-method"><summary>계산 방식·예측 보관과 실제값 비교</summary><p>10월 16일 00시(KST) 이후 최근 최대 7일의 두 팀 관측만 사용합니다. 15분 초과 관측 공백과 득표 정정 구간은 학습에서 제외합니다. 30분 시간대별 표차 변화율을 날짜별로 묶고, 최근 날짜 가중치(2일 반감기)와 앞뒤 시간대 25% 평활화를 적용합니다. 최근 3시간의 패턴 대비 차이 중 25%를 추가하되 6시간에 걸쳐 지수적으로 줄입니다. 결과는 5분 간격 288개 구간으로 계산합니다.</p><p>최소 24시간의 학습과 48개 시간대 중 42개 이상 관측이 필요합니다. 아직 며칠치 자료이므로 반복 패턴이 유지된다는 가정이며, 투표 집중·동원·추세 변화는 미리 알 수 없습니다. 확률이나 확정 결과가 아닙니다.</p><p>‘저장 예측’은 이 브라우저에서 실제 발행한 예측을 매일 00시·12시 기준 1개씩, 최근 72개까지 보관합니다. 브라우저 저장소를 지우면 삭제되며 다른 기기와 공유하지 않습니다. ‘과거 재현’은 선택한 00시·12시 이후 자료를 학습에서 배제한 재계산입니다. 사전에 발행된 예측과 구분합니다. 오차는 실제 − 예측이며 실제 관측 시각에서 계산합니다. 앞으로의 실제값은 접속·새로고침 후 추가되며 관측이 없으면 —로 남깁니다.</p></details>`;
root.appendChild(section);const $=id=>document.getElementById(id);
function options(){
 const cutoff=MMAGapModel.scheduledCutoff();
 const opts=[{value:'live',label:date(cutoff)+' · 최신 정시 예측'}];
 saved.slice().reverse().filter(m=>m.cutoff<cutoff).forEach(m=>opts.push({value:'saved:'+m.cutoff,label:date(m.cutoff)+' · 저장 예측'}));
 for(let h=12;h<=72;h+=12){const t=cutoff-h*3600000;if(t<MMAGapModel.START+86400000)break;opts.push({value:'replay:'+t,label:date(t)+' · 정시 과거 재현'});}
 if(!opts.some(o=>o.value===choice))choice='live';$('gf-origin').innerHTML=opts.map(o=>`<option value="${o.value}" ${o.value===choice?'selected':''}>${o.label}</option>`).join('');
}
function getActual(target,pts){if(!pts.length||target>pts.at(-1).t)return null;let found=null;for(const p of pts){if(p.t>target)break;found=p;}return found&&target-found.t<=5*60000?found:null;}
function comparison(model){const c=MMAGapModel.compare(model,data.snapshots);return c.samples.length?`<strong>${fmt(c.mae)}표</strong> 평균 절대 오차 · ${c.samples.length}회 실제 관측 비교<br>최근 ${date(c.last.t)} · 예측 ${signed(c.last.predicted)} / 실제 ${signed(c.last.actual)} / 오차 <b>${signed(c.last.error)}표</b>`:'아직 예측 이후 실제 관측이 없습니다. 새로고침 후 누적 비교합니다.';}
function table(model,step){const pts=MMAGapModel.points(data.snapshots);return `<div class="table-scroll gf-table"><table><thead><tr><th>시각 (KST)</th><th>예측 표차</th><th>현재 대비 변화</th><th>실제 표차</th><th>실제 − 예측</th></tr></thead><tbody>`+model.path.filter((p,i)=>i>0&&i%step===0).map(p=>{const a=getActual(p.t,pts),pred=a?MMAGapModel.predicted(model,a.t):null;return `<tr><th>${date(p.t)}</th><td>${signed(p.g)}</td><td>${signed(p.g-model.gap)}</td><td title="${a?date(a.t)+' 관측':''}">${a?signed(a.g):'—'}</td><td>${a?signed(a.g-pred):'—'}</td></tr>`;}).join('')+'</tbody></table></div>';}
function chart(model){
 const W=Math.max(300,Math.floor($('gf-chart').getBoundingClientRect().width||900)),H=340,box={x:65,y:20,w:W-82,h:H-68};
 const all=MMAGapModel.points(data.snapshots),actual=all.filter(p=>p.t>=model.origin-3*3600000&&p.t<=model.origin+86400000),values=[...model.path.map(p=>p.g),...actual.map(p=>p.g),0];
 const lo=Math.min(...values),hi=Math.max(...values),pad=Math.max(50,(hi-lo)*.1),min=lo-pad,max=hi+pad,xmin=model.origin-3*3600000,xmax=model.origin+86400000;
 const x=t=>box.x+(t-xmin)/(xmax-xmin)*box.w,y=g=>box.y+(max-g)/(max-min)*box.h,path=pts=>pts.map((p,i)=>(i?'L':'M')+x(p.t).toFixed(1)+','+y(p.g).toFixed(1)).join(' ');
 const ticks=Array.from({length:5},(_,i)=>min+(max-min)*i/4).map(v=>`<line x1="${box.x}" x2="${W-17}" y1="${y(v)}" y2="${y(v)}" stroke="#393346"/><text x="${box.x-8}" y="${y(v)+4}" text-anchor="end">${fmt(v)}</text>`).join('');
 const count=W<500?3:5,labels=Array.from({length:count},(_,i)=>{const t=xmin+(xmax-xmin)*i/(count-1);return `<text x="${x(t)}" y="${H-16}" text-anchor="${i===0?'start':i===count-1?'end':'middle'}">${date(t)}</text>`;}).join('');
 $('gf-chart').setAttribute('viewBox',`0 0 ${W} ${H}`);$('gf-chart').innerHTML=`<title>리센느와 임영웅의 표차 실제값과 향후 24시간 조건부 예측</title><g fill="#aba3b8" font-size="10">${ticks}${labels}</g><line x1="${box.x}" x2="${W-17}" y1="${y(0)}" y2="${y(0)}" stroke="#d6c9e2" stroke-dasharray="3 3"/><line x1="${x(model.origin)}" x2="${x(model.origin)}" y1="20" y2="${H-48}" stroke="#877b95" stroke-dasharray="3 4"/><path d="${path(model.path)}" stroke="#ff789a" stroke-width="2" stroke-dasharray="5 4" fill="none"/><path d="${path(actual)}" stroke="#4fc8e0" stroke-width="1.8" fill="none"/>`;
 $('gf-chart').onpointermove=e=>{const rect=e.currentTarget.getBoundingClientRect(),t=Math.max(model.origin,Math.min(xmax,xmin+((e.clientX-rect.left)*W/rect.width-box.x)/box.w*(xmax-xmin))),p=MMAGapModel.predicted(model,t),a=getActual(t,all);$('gf-hover').textContent=`${date(t)} · 예측 ${signed(p)}표${a?' · 실제 '+signed(a.g)+'표 ('+date(a.t)+') · 오차 '+signed(a.g-MMAGapModel.predicted(model,a.t))+'표':''}`;};
}
function render(){
 if(!data?.snapshots?.length)return;
 const cutoff=MMAGapModel.scheduledCutoff(),last=data.snapshots.at(-1),key=cutoff+':'+last.sourceAt+':'+data.snapshots.length;
 let fixed=saved.find(m=>m.cutoff===cutoff);
 if(!fixed&&cacheKey!==key){cacheModel=MMAGapModel.scheduled(data.snapshots,cutoff);cacheKey=key;if(cacheModel){saved.push(cacheModel);saved=saved.slice(-72);fixed=cacheModel;try{localStorage.setItem(KEY,JSON.stringify(saved));}catch{}}}
 const live=fixed||saved.filter(m=>m.cutoff<cutoff).at(-1)||null;
 options();
 active=choice==='live'?live:choice.startsWith('saved:')?saved.find(m=>m.cutoff===+choice.split(':')[1]):MMAGapModel.scheduled(data.snapshots,+choice.split(':')[1]);
 if(!active){$('gf-content').innerHTML='<p class="gf-empty">予測 대기: 둘째 날 00시 이후 최소 24시간과 충분한 시간대 관측이 필요합니다. 미관측 값은 생성하지 않습니다.</p>'.replace('予測','예측');return;}
 const m=active,mode=choice.startsWith('replay:')?'과거 시점 재현':choice.startsWith('saved:')?'당시 저장한 정시 예측':'최신 정시 예측';
 const pending=choice==='live'&&m.cutoff<cutoff;
 $('gf-content').innerHTML=`<p class="gf-stamp">${mode} · 기준 ${date(m.cutoff)} KST · 다음 갱신 ${date(m.cutoff+12*3600000)} KST${pending?' · 새 기준 이력 반영 대기':''} · 학습 ${date(m.trainingFrom)} ~ ${date(m.trainingTo)} · ${m.observations}회 · 시간대별 ${m.minDays}~${m.maxDays}일 자료</p><div class="gf-cards">`+[0,6,12,24].map(h=>{const p=m.path[h*12];return `<div><span>${h?h+'시간 후':'기준 시점'} 표차</span><strong>${signed(p.g)}표</strong><small>${h?'기준 대비 '+signed(p.g-m.gap)+'표':m.gap>=0?'리센느 우세':'임영웅 우세'}</small></div>`;}).join('')+`</div><p class="gf-legend"><span>━━ 실제 표차</span><span>┄┄ 5분 간격 조건부 예측</span></p><svg id="gf-chart" role="img" aria-label="리센느와 임영웅 24시간 표차 예측 및 실제 비교"></svg><p id="gf-hover" class="gf-hover">차트 위에 마우스나 손가락을 올리면 시각별 예측값을 확인할 수 있습니다.</p><div class="gf-accuracy"><span>선택 예측의 실제값 비교</span><p>${comparison(m)}</p></div><details><summary>시간별 예측 수치와 실제 오차 (24시간)</summary>${table(m,12)}</details><details id="gf-detail"><summary>5분 단위 상세 수치 (288구간)</summary><div id="gf-fine"></div></details>`;
 $('gf-detail').addEventListener('toggle',e=>{if(e.target.open&&!$('gf-fine').children.length)$('gf-fine').innerHTML=table(m,1);});chart(m);
}
$('gf-origin').addEventListener('change',e=>{choice=e.target.value;render();});window.addEventListener('mma:data',e=>{data=e.detail;render();});let timer;window.addEventListener('resize',()=>{clearTimeout(timer);timer=setTimeout(()=>{if(active&&$('gf-chart'))chart(active);},150);});function checkDue(){
 const next=MMAGapModel.scheduledCutoff();if(next!==lastDue){lastDue=next;choice='live';render();window.dispatchEvent(new Event('mma:forecast-due'));}
 clearTimeout(dueTimer);dueTimer=setTimeout(checkDue,Math.max(1000,next+12*3600000-Date.now()+500));
}
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)checkDue();});checkDue();render();
})();
