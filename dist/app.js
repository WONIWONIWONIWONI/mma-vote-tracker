/* VOTE/TRACK: observed points only; straight lines bridge missing observations. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const nf = new Intl.NumberFormat('ko-KR');
  const palette = ['#ff789a', '#b997ff', '#4fc8e0', '#ffc06c', '#83d9b5', '#9cbcff'];
  const colors = {'994944':'#ff789a','3709231':'#e6ff54','3574243':'#4fc8e0','3207401':'#ffc06c','672375':'#83d9b5','3478478':'#9cbcff'};
  const gapDefs = [[0,1],[1,2],[2,3],[0,2],[0,3],[1,3]].map(([a,b],i)=>({id:`gap${a}${b}`,a,b,name:`${a+1}–${b+1}위`,color:palette[i]}));
  function rankGap(s,g){return s.top4[g.a].votes-s.top4[g.b].votes;}
  const state = {data:window.MMA_SEED,metric:'votes',hiddenTeams:new Set(),zoom:1,center:50,timeZoom:1,timeCenter:50,forecast:true,range:'1',historyLimit:12,hourlyDate:null,hourlyLimit:6,fetching:false,loadFailed:false,historyLoaded:false,lastCheckedAt:0,archive:null,localObservations:[],directOK:false,archiveFailed:false};
  const escapeHTML = value => String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt = n => nf.format(n);
  const share = (team,snap) => 100*team.votes/snap.totalVotes;
  const displayShare = (team,snap) => Number.isFinite(team.reportedShare)?String(team.reportedShare):share(team,snap).toFixed(1);
  const normalizedId = team => String(team.id||team.name).normalize('NFKC').trim().toLowerCase().replace(/\s+/g,' ');
  function colorOf(team){const id=normalizedId(team);if(colors[id])return colors[id];const used=new Set(Object.values(colors));const extra=['#f5f278','#ffffff','#ed94df','#b3b98a'];return colors[id]=extra.find(c=>!used.has(c))||'#d3c8bd';}
  function kst(iso,mode='full') {const d=new Date(iso);const p=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(d);const f=Object.fromEntries(p.map(x=>[x.type,x.value]));return mode==='time'?`${f.hour}:${f.minute}`:mode==='short'?`${f.month}.${f.day} ${f.hour}:${f.minute}`:`${f.year}.${f.month}.${f.day} ${f.hour}:${f.minute}`;}
  function normalize(data) {
    if(!data || ![1,2].includes(data.schemaVersion) || !Array.isArray(data.snapshots) || !data.snapshots.length)throw new Error('기록 형식이 올바르지 않습니다.');
    const seen=new Set();
    const snapshots=data.snapshots.map(original=>{
      const s={...original};
      if(!Number.isFinite(Date.parse(s.sourceAt))||seen.has(s.sourceAt)||!Number.isSafeInteger(s.totalVotes)||s.totalVotes<=0||!Array.isArray(s.top4)||s.top4.length<4||s.top4.length>6)throw new Error('유효하지 않은 집계 기록입니다.');
      seen.add(s.sourceAt);let sum=0;const ids=new Set();
      const top4=s.top4.map((t,i)=>{
        if(!t.name||!Number.isSafeInteger(t.votes)||t.votes<0||t.votes>s.totalVotes)throw new Error('득표수 형식이 올바르지 않습니다.');
        const id=normalizedId(t);if(ids.has(id))throw new Error('중복된 아티스트입니다.');ids.add(id);sum+=t.votes;
        if(i&&s.top4[i-1].votes<t.votes)throw new Error('순위와 표수가 일치하지 않습니다.');
        if(t.reportedShare!=null&&(!Number.isFinite(t.reportedShare)||Math.abs(t.reportedShare-100*t.votes/s.totalVotes)>.501))throw new Error('점유율과 표수가 일치하지 않습니다.');
        return {...t,id,rank:i+1};
      });if(sum>s.totalVotes)throw new Error('총투표수보다 상위 득표수의 합이 큽니다.');
      return {...s,top4};
    }).sort((a,b)=>Date.parse(a.sourceAt)-Date.parse(b.sourceAt));
    return {...data,schemaVersion:2,snapshots};
  }
  const liveHistoryURL = 'https://raw.githubusercontent.com/WONIWONIWONIWONI/mma-vote-tracker/main/dist/data/history.json';
  const liveLatestURL=liveHistoryURL.replace('history.json','latest.json');
  const melonURL='https://m2.melon.com/m6/mma/2026/vote/top10.json?lang=ko';
  const operationEnd=()=>Date.parse(state.data.operation?.endsAt||'2026-10-29T15:10:00Z');
  const latest = () => state.data.snapshots.at(-1);
  function previousObservation(){return state.data.snapshots.at(-2)||null;}
  function getSeries() {return state.metric==='gap'?gapDefs:latest().top4.filter(t=>!state.hiddenTeams.has(t.id)).map(t=>({id:t.id,name:t.name,color:colorOf(t)}));}
  function getValue(s,series) {if(state.metric==='gap')return rankGap(s,series);const team=s.top4.find(t=>t.id===series.id);return team?(state.metric==='share'?share(team,s):team.votes):null;}
  function windowSnapshots(){const all=state.data.snapshots;if(state.range==='all')return all;const min=Date.parse(latest().sourceAt)-Number(state.range)*3600000;return all.filter(s=>Date.parse(s.sourceAt)>=min);}
  function change(v,digits=0){return `${v>0?'+':v<0?'−':''}${digits?Math.abs(v).toFixed(digits):fmt(Math.abs(v))}`;}
  function status(){
    const last=latest(),age=Math.max(0,Math.floor((Date.now()-Date.parse(last.sourceAt))/60000));
    const stopped=Date.now()>=operationEnd(),direct=last.origin==='melon_browser_api';
    $('status-pill').className='status-pill '+(state.loadFailed||age>=2||stopped?'stale':'live');
    $('status-label').textContent=stopped?'수집 종료':state.loadFailed?'직접 조회 실패':direct?'멜론 직접 조회':'보관 기록';
    $('source-time').textContent=kst(last.sourceAt);
    $('collected-time').textContent=`${age<1?'1분 미만':age+'분'} 전 관측`;
    let note=stopped?'수집 기간이 끝났습니다. 마지막 기록을 표시합니다.':state.loadFailed?'멜론 직접 조회에 실패해 마지막 확인값을 표시합니다. 새로고침으로 다시 시도하세요.':'접속·새로고침 시 멜론 직접 조회 · 자동 조회 없음 · 추이용 서버 기록은 약 5분 간격입니다.';
    if(state.archiveFailed)note+=' 과거 기록 동기화가 지연되어 기존 기록을 유지합니다.';
    const archiveLast=state.archive?.snapshots.at(-1),archiveAge=archiveLast?Math.floor((Date.now()-Date.parse(archiveLast.sourceAt))/60000):0;
    if(archiveLast&&archiveAge>=2&&!stopped)note+=` 추이용 공용 이력은 ${kst(archiveLast.sourceAt,'time')}까지입니다 (${archiveAge}분 전).`;
    if(age>=2&&!stopped)note+=' 현재 수치가 필요하면 새로고침을 눌러 주세요.';
    $('notice-text').textContent=note;$('notice').className='notice '+(!state.loadFailed&&age<2?'good':'');
  }
  function renderCards(){const last=latest();$('leaders').innerHTML=last.top4.map((t,i)=>`<article class="leader ${i===0?'first':''}" style="--color:${colorOf(t)}"><div class="leader-top"><span class="rank-badge"><b>${String(i+1).padStart(2,'0')}</b> RANK</span>${i===0?'<span class="mini-label">현재 선두</span>':''}</div><h2 class="artist" title="${escapeHTML(t.name)}"><i class="artist-dot"></i><span class="artist-name">${escapeHTML(t.name)}</span></h2><div class="count-row"><span class="vote-total"><strong class="vote-value">${fmt(t.votes)}</strong><span class="unit">표</span></span><span class="share-value">${displayShare(t,last)}<span>%</span></span></div><div class="leader-bottom"><span>전체 투표 중 점유율</span><b>${i===0?`2위와 ${fmt(t.votes-last.top4[1].votes)}표 차이`:`${i}위와 ${fmt(last.top4[i-1].votes-t.votes)}표 차이`}</b></div></article>`).join('');$('total-votes').textContent=fmt(last.totalVotes);$('sample-count').textContent=fmt(state.data.snapshots.length);const sum=last.top4.reduce((s,t)=>s+t.votes,0);$('top-share').textContent=(sum/last.totalVotes*100).toFixed(1)+'%';$('other-share').textContent=((last.totalVotes-sum)/last.totalVotes*100).toFixed(1)+'%';$('share-track').innerHTML=last.top4.map(t=>`<i style="width:${share(t,last)}%;background:${colorOf(t)}" title="${escapeHTML(t.name)} ${displayShare(t,last)}%"></i>`).join('')+`<i style="width:${100-sum/last.totalVotes*100}%;background:#453d51" title="그 외"></i>`;}
  function renderPace(){const last=latest(),prev=previousObservation();$('pace-tag').textContent=prev?`${fmt((Date.parse(last.sourceAt)-Date.parse(prev.sourceAt))/60000)}분 간격`:'기록 대기';$('pace-body').innerHTML=last.top4.map(t=>{const p=prev?.top4.find(x=>x.id===t.id);const delta=p?t.votes-p.votes:null,pp=p?share(t,last)-share(p,prev):null;return `<tr><td><span class="table-artist" style="--color:${colorOf(t)}"><i></i>${escapeHTML(t.name)}</span></td><td class="${delta==null?'no-value':delta>=0?'positive':'negative'}">${delta==null?'—':change(delta)+'표'}</td><td class="${pp==null?'no-value':pp>=0?'positive':'negative'}">${pp==null?'—':change(pp,2)+'%p'}</td></tr>`;}).join('');$('pace-note').textContent=prev?`${kst(prev.sourceAt,'short')} → ${kst(last.sourceAt,'short')} · 직전 관측 대비 변화입니다. 직전 관측에서 상위 6위 밖인 팀은 비교 값이 없습니다.`:'관측 기록이 두 개 이상이면 직전 관측 대비 변화를 표시합니다. 아직 없는 값은 —로 표시합니다.';}
  function renderHistory(){
    const all=[...state.data.snapshots].reverse();
    $('history-count').textContent=`${fmt(all.length)}회 관측`;
    $('history-body').innerHTML=all.slice(0,state.historyLimit).map(s=>{
      const teamCells=Array.from({length:6},(_,i)=>{
        const t=s.top4[i];
        return t?`<td><span class="history-name">${escapeHTML(t.name)}</span>${fmt(t.votes)}<span class="history-name" style="display:inline;margin-left:7px">${displayShare(t,s)}%</span></td>`:'<td class="no-value">—</td>';
      }).join('');
      return `<tr><td>${kst(s.sourceAt,'short')}${s.origin==='user_capture'?' · 캡처':''}</td>${teamCells}${gapDefs.map(g=>`<td>${fmt(rankGap(s,g))}표</td>`).join('')}</tr>`;
    }).join('');
    $('load-more').hidden=all.length<=state.historyLimit;
  }
  function hourlyModel(){
    const teams=latest().top4,all=MMAHourly.build(state.data.snapshots,teams),dates=[...new Set(all.map(r=>r.date))];
    const date=dates.includes(state.hourlyDate)?state.hourlyDate:dates[0];
    return {teams,dates,date,rows:all.filter(r=>r.date===date)};
  }
  function hourWinner(row){
    const valid=row.values.filter(v=>v.delta!=null);
    if(!valid.length)return {ids:[],label:'기록 대기'};
    if(new Set(valid.map(v=>v.from+':'+v.to)).size>1)return {ids:[],label:'관측 구간 다름'};
    const max=Math.max(...valid.map(v=>v.delta));
    if(max<=0)return {ids:[],label:max===0?'증가 없음':'득표 감소'};
    return {ids:valid.filter(v=>v.delta===max).map(v=>v.id),label:valid.length<row.values.length?'관측 팀 중 최다':'최다 증가'};
  }
  function renderHourly(){
    const {teams,dates,date,rows}=hourlyModel();
    $('hourly-date').innerHTML=dates.map(d=>`<option value="${d}"${d===date?' selected':''}>${d.replaceAll('-','.')} KST</option>`).join('');
    $('hourly-list').innerHTML=`<table class="hourly-compact"><thead><tr><th>시간 / 최다 증가</th>${teams.map(t=>`<th style="color:${colorOf(t)}">${escapeHTML(t.name)}</th>`).join('')}</tr></thead><tbody>`+rows.slice(0,state.hourlyLimit).map(row=>{
      const winner=hourWinner(row),best=teams.filter(t=>winner.ids.includes(t.id));
      const max=Math.max(1,...row.values.map(v=>Math.abs(v.delta??0)));
      const end=MMAHourly.dayKey(row.end)!==row.date?'24:00':kst(row.end,'time');
      return `<tr><th><b>${kst(row.start,'time')}–${end}</b><small>${best.length?escapeHTML(best.map(t=>t.name).join(' · '))+' ★':winner.label}</small><em>${row.ongoing?'집계 중':row.values.every(v=>v.complete)?'1시간 전체':'일부 구간'}</em></th>`+teams.map(t=>{
        const v=row.values.find(v=>v.id===t.id),coverage=v.delta==null?'기록 부족':`${kst(v.from,'time')}–${kst(v.to,'time')} 관측`;
        return `<td class="${winner.ids.includes(t.id)?'hour-winner':''}" style="--color:${colorOf(t)}" title="${coverage}"><strong>${v.delta==null?'—':change(v.delta)}</strong><span class="mini-bar"><i style="width:${Math.abs(v.delta??0)/max*100}%"></i></span><small>${v.complete?'':coverage}</small></td>`;
      }).join('')+'</tr>';
    }).join('')+'</tbody></table>';
    $('hourly-more').hidden=rows.length<=state.hourlyLimit;$('hourly-more').textContent=`이날 전체 시간 보기 (${rows.length}개)`;
    $('hourly-note').textContent='★ 같은 관측 구간의 최다 증가 팀(동률 포함) · 막대는 같은 행 안에서 비교 · 일부 구간은 실제 관측 시각을 표시합니다. 관측 구간이 다른 팀들은 우승 표시 없이 비교합니다.';
  }
  function axisLabel(value,axis){
    return state.metric==='share'?value.toFixed(axis.decimals)+'%':fmt(Math.round(value));
  }
  function axisRangeLabel(g){
    return `세로축 표시 범위 · ${axisLabel(g.ymin,g.axis)}–${axisLabel(g.ymax,g.axis)}${state.metric==='share'?'':'표'}`;
  }
  function graphGeometry(){
    const rows=windowSnapshots(),series=getSeries(),lastTime=Date.parse(latest().sourceAt);
    const W=Math.max(240,Math.floor($('trend-chart').getBoundingClientRect().width||800)),H=W<600?400:450;
    const forecasts=state.forecast?series.flatMap(line=>{
      const source=state.data.snapshots.filter(r=>Date.parse(r.sourceAt)>=lastTime-3600000);
      if(source.some((r,i)=>i&&(()=>{const a=source[i-1].top4.find(t=>t.id===line.id),b=r.top4.find(t=>t.id===line.id);return a&&b&&b.votes<a.votes;})()))return [];
      const points=source.map(r=>({t:Date.parse(r.sourceAt),v:getValue(r,line)})).filter(p=>p.v!=null);
      const f=MMAAnalytics.forecast(points,60);if(!f||f.time!==lastTime)return [];
      return [{...line,...f,points:f.points.map(p=>({...p,value:Math.max(0,Math.min(state.metric==='share'?100:Infinity,p.value))}))}];
    }):[];
    const values=rows.flatMap(r=>series.map(line=>getValue(r,line))).filter(Number.isFinite).concat(forecasts.flatMap(f=>f.points.map(p=>p.value)));
    let axis=MMAAxis.fit(values,state.metric,W<600?4:5);const baseAxis=axis;
    if(state.zoom>1){const span=(axis.max-axis.min)/state.zoom,min=axis.min+(axis.max-axis.min-span)*state.center/100;const step=span/4;axis={...axis,min,max:min+span,decimals:state.metric==='share'?2:0,ticks:Array.from({length:5},(_,i)=>min+i*step)};}
    const left=Math.max(55,Math.max(...axis.ticks.map(v=>axisLabel(v,axis).length))*6.5+14),box={x:left,y:24,w:W-left-15,h:H-72};
    let baseXmin=Date.parse(rows[0].sourceAt),baseXmax=Math.max(lastTime,...forecasts.map(f=>f.points.at(-1).time));
    if(baseXmin===baseXmax){baseXmin-=300000;baseXmax+=300000;}
    const timeSpan=(baseXmax-baseXmin)/state.timeZoom,xmin=baseXmin+(baseXmax-baseXmin-timeSpan)*state.timeCenter/100,xmax=xmin+timeSpan;
    return {rows,series,forecasts,lastTime,W,H,box,xmin,xmax,baseXmin,baseXmax,baseAxis,axis,ymin:axis.min,ymax:axis.max,x:t=>box.x+(t-xmin)/(xmax-xmin)*box.w,y:v=>box.y+box.h-(v-axis.min)/(axis.max-axis.min)*box.h};
  }
  function renderChart(){
    const g=graphGeometry(),{rows,series,forecasts,lastTime,W,H,box,x,y,xmin,xmax,axis}=g,svg=$('trend-chart');
    svg.setAttribute('viewBox',`0 0 ${W} ${H}`);svg.style.height=`${H}px`;svg.dataset.ymin=g.ymin;svg.dataset.ymax=g.ymax;svg.dataset.xmin=xmin;svg.dataset.xmax=xmax;
    const pannable=state.zoom>1||state.timeZoom>1;
    svg.style.touchAction=pannable?'none':'pan-y';svg.style.cursor=trendDrag?'grabbing':pannable?'grab':'default';
    $('trend-left').disabled=state.timeZoom===1||state.timeCenter<=0;$('trend-right').disabled=state.timeZoom===1||state.timeCenter>=100;$('trend-up').disabled=$('trend-down').disabled=state.zoom===1;
    $('chart-unit').textContent=state.metric==='share'?'전체 대비 점유율 (%)':'득표수 (표)';
    $('chart-axis-note').textContent=`시간축 ${state.timeZoom}배 · 세로 ${state.zoom}배 · ${axisRangeLabel(g)}`;
    $('chart-legend').innerHTML=latest().top4.map(t=>`<button class="legend-item team-toggle ${state.hiddenTeams.has(t.id)?'muted-team':''}" data-team="${escapeHTML(t.id)}" aria-pressed="${!state.hiddenTeams.has(t.id)}" style="--color:${colorOf(t)}"><i></i>${escapeHTML(t.name)}</button>`).join('');
    const grid=axis.ticks.map(v=>`<line x1="${box.x}" y1="${y(v)}" x2="${box.x+box.w}" y2="${y(v)}" stroke="#3b374d" stroke-dasharray="3 5"/><text x="${box.x-9}" y="${y(v)+4}" text-anchor="end" fill="#aaa3b8" font-size="10">${axisLabel(v,axis)}</text>`);
    const n=W<480?3:6;for(let i=0;i<n;i++){const t=xmin+(xmax-xmin)*i/(n-1);grid.push(`<text x="${x(t)}" y="${H-20}" text-anchor="${i===0?'start':i===n-1?'end':'middle'}" fill="#aaa3b8" font-size="10">${kst(t,'time')}</text>`);}
    const futureX=Math.max(box.x,Math.min(box.x+box.w,x(lastTime))),futureWidth=box.x+box.w-futureX;
    if(forecasts.length&&xmax>lastTime)grid.push(`<rect x="${futureX}" y="${box.y}" width="${futureWidth}" height="${box.h}" fill="#b997ff0b"/><line x1="${futureX}" x2="${futureX}" y1="${box.y}" y2="${box.y+box.h}" stroke="#aaa3b8" stroke-dasharray="3 5"/><text x="${futureX+5}" y="15" fill="#c4b3e9" font-size="10">점선: 조건부 예측</text>`);
    const path=points=>{let active=false;return points.map(p=>{if(p.value==null){active=false;return '';}const cmd=active?'L':'M';active=true;return `${cmd}${x(p.time)},${y(p.value)}`;}).join(' ');};
    let lines=series.map(line=>`<path d="${path(rows.map(r=>({time:Date.parse(r.sourceAt),value:getValue(r,line)})))}" fill="none" stroke="${line.color}" stroke-width="1.6"/>`).join('');
    lines+=forecasts.map(f=>`<path d="${path(f.points)}" fill="none" stroke="${f.color}" stroke-width="1.6" stroke-dasharray="5 5"/>`).join('');
    const hits=rows.map((r,i)=>`<rect x="${x(Date.parse(r.sourceAt))-Math.max(2,Math.min(16,box.w/rows.length/2))}" y="${box.y}" width="${Math.max(4,Math.min(32,box.w/rows.length))}" height="${box.h}" fill="transparent" data-point="${i}" tabindex="0" aria-label="${kst(r.sourceAt)} 실제 관측"/>`).join('');
    const future=forecasts.length&&xmax>lastTime?`<rect x="${futureX}" y="${box.y}" width="${futureWidth}" height="${box.h}" fill="transparent" id="forecast-hit"/>`:'';
    svg.innerHTML=`<title>선택한 팀의 실제 추이와 조건부 예측</title><defs><clipPath id="trend-clip"><rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}"/></clipPath></defs>${grid.join('')}<g clip-path="url(#trend-clip)">${lines}${hits}${future}</g>`;
    svg.querySelectorAll('[data-point]').forEach(el=>{const show=()=>{if(!trendDrag)showTooltip(rows[+el.dataset.point],series,el,g);};el.addEventListener('pointerenter',show);el.addEventListener('focus',show);el.addEventListener('pointerleave',hideTooltip);el.addEventListener('blur',hideTooltip);});
    const fh=svg.querySelector('#forecast-hit');if(fh){fh.addEventListener('pointermove',e=>{if(trendDrag)return;const r=svg.getBoundingClientRect(),px=(e.clientX-r.left)*W/r.width,t=Math.max(lastTime,Math.min(xmax,xmin+(px-box.x)/box.w*(xmax-xmin)));const tt=$('tooltip');tt.innerHTML=`<strong>${kst(t)} · 예측(실제값 아님)</strong>`+forecasts.filter(f=>t<=f.points.at(-1).time).map(f=>`<p><span style="color:${f.color}">${escapeHTML(f.name)}</span><b>${state.metric==='share'?Math.max(0,Math.min(100,f.last+f.slope*(t-lastTime)/60000)).toFixed(2)+'%':fmt(Math.round(Math.max(0,f.last+f.slope*(t-lastTime)/60000)))+'표'}</b></p>`).join('');tt.hidden=false;tt.style.left=Math.max(0,Math.min(r.width-tt.offsetWidth,(e.clientX-r.left)-tt.offsetWidth))+'px';tt.style.top='38px';});fh.addEventListener('pointerleave',hideTooltip);}
    $('chart-note').textContent=`실선: 실제 관측 · ${state.forecast?(forecasts.length?`점선: 최근 60분 가중 선형회귀 (${forecasts.length}/${series.length}팀) · 최대 30분 조건부 추정`:'예측 보류: 관측 부족·공백·정정 또는 불안정한 추세'):'예측 끔'} · 미관측 구간은 직선 연결`;
    $('chart-window').textContent=`${kst(xmin,'short')} — ${kst(xmax,'short')}${xmax>lastTime?' (예측 구간 포함)':' 실제 관측 구간'}`;
  }
  function showTooltip(s,series,el,g){const tt=$('tooltip');tt.innerHTML=`<strong>${kst(s.sourceAt)} KST</strong>`+series.map(line=>{const v=getValue(s,line);return `<p><span><i style="background:${line.color}"></i>${escapeHTML(line.name)}</span><b>${v==null?'—':state.metric==='share'?v.toFixed(2)+'%':fmt(v)+'표'}</b></p>`;}).join('');tt.hidden=false;const wrap=$('trend-chart').getBoundingClientRect();const p=g.x(Date.parse(s.sourceAt))/g.W*wrap.width;tt.style.left=Math.max(0,Math.min(wrap.width-tt.offsetWidth,p+12))+'px';tt.style.top='38px';}
  function hideTooltip(){$('tooltip').hidden=true;}
  function render(){status();renderCards();renderPace();renderHistory();renderChart();renderHourly();window.MMA_DATA=state.data;window.dispatchEvent(new CustomEvent('mma:data',{detail:state.data}));}
  function mergeRecent(current,recent){
    const rows=new Map(current.snapshots.map(s=>[Math.floor(Date.parse(s.sourceAt)/60000),s]));
    recent.snapshots.forEach(s=>rows.set(Math.floor(Date.parse(s.sourceAt)/60000),s));
    // A long absence or a historical edit requires a full resync, not an invented gap.
    if(!Number.isSafeInteger(recent.historyCount)||rows.size!==recent.historyCount)return null;
    return normalize({...recent,snapshots:[...rows.values()]});
  }
  async function fetchRecord(source){
    // Read the branch via the contents API first, bypassing the raw-file CDN.
    // Anonymous API limits or failures fall back to the original public URL.
    const api=source.replace('https://raw.githubusercontent.com/WONIWONIWONIWONI/mma-vote-tracker/main/','https://api.github.com/repos/WONIWONIWONIWONI/mma-vote-tracker/contents/');
    for(const endpoint of [api,source]){
      const url=new URL(endpoint);url.searchParams.set('v',String(Date.now()));
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),6000);
      try{
        const response=await fetch(url,{cache:'no-store',credentials:'omit',headers:endpoint===api?{Accept:'application/vnd.github.raw+json'}:{},signal:controller.signal});
        if(!response.ok)throw new Error('기록을 읽지 못했습니다.');
        return normalize(await response.json());
      }catch(error){if(endpoint===source)throw error;}
      finally{clearTimeout(timer);}
    }
  }
  function applyData(){
    state.data=normalize(MMAData.combine(state.archive||state.data,state.localObservations));
    render();
  }
  async function loadArchive(){
    try{
      let candidate;
      if(!state.historyLoaded)candidate=await fetchRecord(liveHistoryURL);
      else{const recent=await fetchRecord(liveLatestURL);candidate=mergeRecent(state.archive,recent)||await fetchRecord(liveHistoryURL);}
      if(candidate.historyCount!=null&&candidate.historyCount!==candidate.snapshots.length)throw new Error('Incomplete archive');
      if(state.archive&&Date.parse(candidate.snapshots.at(-1).sourceAt)<Date.parse(state.archive.snapshots.at(-1).sourceAt))throw new Error('Older archive');
      state.archive=candidate;state.historyLoaded=true;state.archiveFailed=false;
    }catch{state.archiveFailed=true;}
    applyData();
  }
  async function refresh(manual=false){
    if(state.fetching||location.protocol==='file:')return;
    state.fetching=true;state.lastCheckedAt=Date.now();$('refresh-button').disabled=true;
    // Start archival sync independently: a slow GitHub response must not delay live cards.
    if(!state.archiveTask)state.archiveTask=loadArchive().catch(()=>{state.archiveFailed=true;status();}).finally(()=>{state.archiveTask=null;});
    try{
      if(Date.now()<operationEnd()){
        const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
        try{
          const response=await fetch(melonURL+'&t='+Date.now(),{cache:'no-store',credentials:'omit',signal:controller.signal});
          if(!response.ok)throw new Error('Melon HTTP '+response.status);
          const snapshot=MMAData.parse(await response.json(),new Date().toISOString());
          state.localObservations=MMAData.merge(state.localObservations,[snapshot]);
          state.loadFailed=false;state.directOK=true;applyData();
          if(manual)toast('멜론에서 최신 수치를 직접 조회했습니다.');
        }finally{clearTimeout(timer);}
      }
    }catch{state.loadFailed=true;render();if(manual)toast('멜론 직접 조회 실패 · 마지막 확인값을 유지합니다.');}
    finally{state.fetching=false;$('refresh-button').disabled=false;}
  }
  function toast(text){$('toast').textContent=text;$('toast').hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('toast').hidden=true,4200);}
  function download(blob,name){const u=URL.createObjectURL(blob);const a=document.createElement('a');a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),10000);}
  function exportCSV(){const cells=v=>{let s=String(v??'');if(/^[=+@\-]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};const rows=[['집계시각_KST','출처','전체투표','순위','아티스트','득표수','전체대비점유율_%','표시점유율_%',...gapDefs.map(g=>g.name+'표차')]];for(const s of state.data.snapshots)for(const t of s.top4)rows.push([kst(s.sourceAt),s.origin,s.totalVotes,t.rank,t.name,t.votes,share(t,s).toFixed(4),displayShare(t,s),...gapDefs.map(g=>rankGap(s,g))]);download(new Blob(['\uFEFF'+rows.map(r=>r.map(cells).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}),'mma-top6-history.csv');}
  async function copySummary(){const s=latest();const lines=[`[2026 MMA] ${kst(s.sourceAt)} KST 기준`,...s.top4.map(t=>`${t.rank}위 ${t.name}: ${fmt(t.votes)}표 (${displayShare(t,s)}%)`),...gapDefs.map(g=>`${g.name} 표차: ${fmt(rankGap(s,g))}표`),`총투표수 ${fmt(s.totalVotes)}표`,s.origin==='user_capture'?'첨부 화면에서 확인한 기록 · 실시간 연결 전':'Melon 공개 투표 집계',location.protocol==='file:'?'https://www.melon.com/mma/2026/vote/top10/':location.href];try{await navigator.clipboard.writeText(lines.join('\n'));toast('집계 요약을 복사했습니다.');}catch{toast('복사 권한이 없습니다. CSV 다운로드를 이용해 주세요.');}}
  function imageModel(type){
    const last=latest(),stamp=kst(last.sourceAt),suffix=stamp.replace(/[^0-9]/g,'');
    const common={type,sourceAt:stamp,filename:`mma-${type}-${suffix}.png`};
    if(type==='trend'){
      const g=graphGeometry();
      return {...common,title:'현재 득표 현황과 추이',subtitle:'그래프 기간 · '+$('chart-window').textContent+' KST',chartTitle:$('chart-unit').textContent+' 추이',
        leaders:last.top4.map((team,i)=>{const other=last.top4[i===0?1:i-1];return {rank:team.rank,name:team.name,color:colorOf(team),votes:fmt(team.votes)+'표',share:displayShare(team,last)+'%',gap:other.name+'와 '+fmt(Math.abs(team.votes-other.votes))+'표 차이'};}),
        xmin:g.xmin,xmax:g.xmax,ymin:g.ymin,ymax:g.ymax,
        ticks:g.axis.ticks.map(value=>({value,label:axisLabel(value,g.axis)})),
        series:g.series.map(line=>({...line,points:g.rows.map(row=>({time:Date.parse(row.sourceAt),value:getValue(row,line)}))})),
        firstLabel:kst(g.rows[0].sourceAt,'short'),lastLabel:kst(g.xmax,'short')+(g.forecasts.length?' 예측':''),forecasts:g.forecasts,lastTime:g.lastTime,
        rangeNote:axisRangeLabel(g),note:$('chart-note').textContent,filename:`mma-trend-${state.metric}-${suffix}.png`};
    }
    if(type==='pace'){
      const prev=previousObservation();
      return {...common,title:'직전 관측 대비 움직임',subtitle:prev?`${kst(prev.sourceAt)} → ${stamp} · ${fmt((Date.parse(last.sourceAt)-Date.parse(prev.sourceAt))/60000)}분 간격`:'두 번째 관측을 기다리는 중입니다.',
        rows:last.top4.map(team=>{const old=prev?.top4.find(item=>item.id===team.id),delta=old?team.votes-old.votes:null,pp=old?share(team,last)-share(old,prev):null;
          return {name:team.name,color:colorOf(team),delta,share:pp,deltaText:delta==null?'—':change(delta)+'표',shareText:pp==null?'—':change(pp,2)+'%p'};}),
        note:'실제 두 관측 사이의 변화입니다. 비교 관측이 없는 팀은 —로 표시합니다.'};
    }
    if(type==='hourly'){
      const teams=last.top4,date=$('hourly-date').value;
      const rows=MMAHourly.build(state.data.snapshots,teams).filter(row=>row.date===date);
      return {...common,title:'시간대별 득표 증가량',subtitle:date.replaceAll('-','.')+' · 선택 날짜의 모든 시간대',filename:`mma-hourly-${date}.png`,
        max:Math.max(1,...rows.flatMap(row=>row.values.map(value=>Math.abs(value.delta??0)))),
        rows:rows.map(row=>{const complete=row.values.every(value=>value.complete),empty=row.values.every(value=>value.delta==null);
          const end=MMAHourly.dayKey(row.end)!==row.date?'24:00':kst(row.end,'time');
          return {label:kst(row.start,'time')+'–'+end,complete,status:empty?'비교 기록 대기':complete?'1시간 전체':row.ongoing?'집계 중':'일부 구간',
            values:teams.map(team=>{const value=row.values.find(value=>value.id===team.id);return {...value,name:team.name,color:colorOf(team),
              label:value.delta==null?'—':change(value.delta)+'표',
              coverage:value.delta==null?'비교할 관측 기록이 부족합니다.':value.complete?'':`${kst(value.from,'time')}–${kst(value.to,'time')} 실제 관측 (${fmt((value.to-value.from)/60000)}분)`};})};})};
    }
    throw new Error('Unknown image panel.');
  }
  let imagePending=false;
  async function exportPanel(button){
    if(imagePending){toast('이미지를 준비하고 있습니다.');return;}
    imagePending=true;button.disabled=true;let canvas;
    try{
      // Capture the selected data before fonts load or another update arrives.
      const model=imageModel(button.dataset.image);
      await document.fonts.ready;
      canvas=MMAImages.render(model);
      const blob=await new Promise((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error('Empty image.')),'image/png'));
      download(blob,model.filename);
    }catch{toast('이미지를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.');}
    finally{if(canvas){canvas.width=1;canvas.height=1;}imagePending=false;button.disabled=false;}
  }
  document.addEventListener('click',event=>{const button=event.target.closest('[data-image]');if(button)exportPanel(button);});
  document.querySelectorAll('[data-metric]').forEach(button=>button.addEventListener('click',()=>{state.metric=button.dataset.metric;document.querySelectorAll('[data-metric]').forEach(b=>{b.classList.toggle('selected',b===button);b.setAttribute('aria-pressed',String(b===button));});hideTooltip();state.zoom>1?focusTrend():renderChart();}));
  document.querySelectorAll('[data-range]').forEach(button=>button.addEventListener('click',()=>{state.range=button.dataset.range;state.timeZoom=1;state.timeCenter=50;$('trend-time-zoom').value='1';$('trend-time-center').value='50';$('trend-time-center').disabled=true;document.querySelectorAll('[data-range]').forEach(b=>{b.classList.toggle('selected',b===button);b.setAttribute('aria-pressed',String(b===button));});hideTooltip();state.zoom>1?focusTrend():renderChart();}));
  $('hourly-date').addEventListener('change',event=>{state.hourlyDate=event.target.value;state.hourlyLimit=6;renderHourly();});
  $('hourly-more').addEventListener('click',()=>{state.hourlyLimit=24;renderHourly();});
  $('refresh-button').addEventListener('click',()=>refresh(true));$('csv-button').addEventListener('click',exportCSV);$('copy-button').addEventListener('click',copySummary);$('load-more').addEventListener('click',()=>{state.historyLimit+=12;renderHistory();});$('history-details').addEventListener('toggle',()=>{$('history-toggle-label').textContent=$('history-details').open?'접기':'펼치기';});let resizeTimer;addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(renderChart,120);});
  $('chart-legend').addEventListener('click',e=>{const b=e.target.closest('[data-team]');if(!b)return;const id=b.dataset.team;if(state.hiddenTeams.has(id))state.hiddenTeams.delete(id);else if(getSeries().length>1)state.hiddenTeams.add(id);state.zoom=1;$('trend-zoom').value='1';$('trend-center').disabled=true;hideTooltip();renderChart();});
  function moveTrend(value,timeValue=state.timeCenter){state.center=Math.max(0,Math.min(100,value));state.timeCenter=Math.max(0,Math.min(100,timeValue));$('trend-center').value=String(state.center);$('trend-time-center').value=String(state.timeCenter);hideTooltip();renderChart();}
  function moveTime(value){moveTrend(state.center,value);}
  function focusTime(target,ratio=.5){const g=graphGeometry(),span=(g.baseXmax-g.baseXmin)/state.timeZoom;moveTime(state.timeZoom>1?100*((target??g.lastTime)-ratio*span-g.baseXmin)/(g.baseXmax-g.baseXmin-span):50);}
  $('trend-time-zoom').addEventListener('change',e=>{const old=graphGeometry(),wasZoomed=state.timeZoom>1;state.timeZoom=+e.target.value;$('trend-time-center').disabled=state.timeZoom===1;focusTime(wasZoomed?(old.xmin+old.xmax)/2:old.lastTime);});
  $('trend-time-center').addEventListener('input',e=>moveTime(+e.target.value));
  $('trend-left').addEventListener('click',()=>moveTime(state.timeCenter-15));
  $('trend-right').addEventListener('click',()=>moveTime(state.timeCenter+15));
  function focusTrend(target){
    const g=graphGeometry(),span=(g.baseAxis.max-g.baseAxis.min)/state.zoom;
    const center=target??getValue(latest(),{id:$('trend-focus').value});
    moveTrend(state.zoom>1&&Number.isFinite(center)?100*(center-span/2-g.baseAxis.min)/(g.baseAxis.max-g.baseAxis.min-span):50);
  }
  $('trend-zoom').addEventListener('change',e=>{
    const previous=graphGeometry(),wasZoomed=state.zoom>1;state.zoom=+e.target.value;
    $('trend-center').disabled=state.zoom===1;
    focusTrend(wasZoomed?(previous.ymin+previous.ymax)/2:undefined);
  });
  $('trend-focus').addEventListener('change',()=>{if(state.zoom===1){state.zoom=4;$('trend-zoom').value='4';$('trend-center').disabled=false;}const id=$('trend-focus').value;state.hiddenTeams.delete(id);focusTrend();});
  $('trend-center').addEventListener('input',e=>moveTrend(+e.target.value));
  $('trend-up').addEventListener('click',()=>moveTrend(state.center+15));
  $('trend-down').addEventListener('click',()=>moveTrend(state.center-15));
  let trendDrag=null;
  $('trend-chart').addEventListener('pointerdown',e=>{if((state.zoom<=1&&state.timeZoom<=1)||e.button>0)return;const g=graphGeometry(),rect=$('trend-chart').getBoundingClientRect();trendDrag={id:e.pointerId,x:e.clientX,y:e.clientY,center:state.center,timeCenter:state.timeCenter,height:g.box.h*rect.height/g.H,width:g.box.w*rect.width/g.W};$('trend-chart').setPointerCapture(e.pointerId);hideTooltip();e.preventDefault();});
  $('trend-chart').addEventListener('pointermove',e=>{if(!trendDrag||e.pointerId!==trendDrag.id)return;moveTrend(state.zoom>1?trendDrag.center+(e.clientY-trendDrag.y)/trendDrag.height*100/(state.zoom-1):state.center,state.timeZoom>1?trendDrag.timeCenter-(e.clientX-trendDrag.x)/trendDrag.width*100/(state.timeZoom-1):state.timeCenter);});
  function endTrendDrag(e){if(trendDrag?.id===e.pointerId){trendDrag=null;$('trend-chart').style.cursor=state.zoom>1||state.timeZoom>1?'grab':'default';hideTooltip();}}
  $('trend-chart').addEventListener('wheel',e=>{
    if(!e.ctrlKey)return;
    e.preventDefault();const old=graphGeometry(),rect=$('trend-chart').getBoundingClientRect(),ratio=Math.max(0,Math.min(1,((e.clientX-rect.left)*old.W/rect.width-old.box.x)/old.box.w));
    const steps=[1,2,4,8],index=steps.indexOf(state.timeZoom),next=steps[Math.max(0,Math.min(3,index+(e.deltaY<0?1:-1)))];
    state.timeZoom=next;$('trend-time-zoom').value=String(next);$('trend-time-center').disabled=next===1;focusTime(old.xmin+ratio*(old.xmax-old.xmin),ratio);
  },{passive:false});
  $('trend-chart').addEventListener('pointerup',endTrendDrag);
  $('trend-chart').addEventListener('pointercancel',endTrendDrag);
  $('trend-chart').addEventListener('lostpointercapture',endTrendDrag);
  $('trend-forecast').addEventListener('change',e=>{state.forecast=e.target.checked;hideTooltip();renderChart();});
  $('trend-reset').addEventListener('click',()=>{state.hiddenTeams.clear();state.zoom=1;state.center=50;state.timeZoom=1;state.timeCenter=50;$('trend-time-zoom').value='1';$('trend-time-center').value='50';$('trend-time-center').disabled=true;$('trend-zoom').value='1';$('trend-center').value='50';$('trend-center').disabled=true;hideTooltip();renderChart();});
  state.data=normalize(state.data);state.archive=state.data;render();if(location.protocol!=='file:')refresh();setInterval(status,30000);
})();

