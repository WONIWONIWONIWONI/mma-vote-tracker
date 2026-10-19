/* Time-of-day gap model v1. Every input is restricted to the forecast origin. */
(function(root){
'use strict';
const MIN=60000,HOUR=60*MIN,DAY=24*HOUR,START=Date.parse('2026-10-16T00:00:00+09:00'),VERSION='slot30-v1';
const slot=t=>Math.floor(((t+9*HOUR)%DAY+DAY)%DAY/(30*MIN));
function points(snapshots,asOf=Infinity){
 const map=new Map();for(const s of snapshots){const t=Date.parse(s.sourceAt);if(t<START||t>asOf||!Number.isFinite(t))continue;const a=s.top4.find(t=>String(t.id)==='3709231'),b=s.top4.find(t=>String(t.id)==='994944');if(a&&b)map.set(t,{t,a:a.votes,b:b.votes,g:a.votes-b.votes});}return [...map.values()].sort((a,b)=>a.t-b.t);
}
function forecast(snapshots,asOf=Infinity){
 const pts=points(snapshots,asOf);if(pts.length<12)return null;const last=pts.at(-1),rows=pts.filter(p=>p.t>=last.t-7*DAY);if(last.t-rows[0].t<DAY)return null;
 const bins=Array.from({length:48},()=>new Map()),intervals=[];
 for(let i=1;i<rows.length;i++){
  const a=rows[i-1],b=rows[i],dt=(b.t-a.t)/MIN;if(dt<=0||dt>15||b.a<a.a||b.b<a.b)continue;
  const rate=(b.g-a.g)/dt;intervals.push({t:b.t,dt,rate});
  for(let t=a.t;t<b.t;){const next=Math.min(b.t,(Math.floor((t+9*HOUR)/(30*MIN))+1)*30*MIN-9*HOUR),n=(next-t)/MIN,day=Math.floor((t+9*HOUR)/DAY),bin=bins[slot(t)];const v=bin.get(day)||{sum:0,n:0,t:0};v.sum+=rate*n;v.n+=n;v.t=Math.max(v.t,next);bin.set(day,v);t=next;}
 }
 const coverage=bins.filter(b=>b.size).length;if(coverage<42)return null;
 const profile=bins.map((_,i)=>{let sw=0,sum=0,days=new Set();for(let k=-1;k<=1;k++){for(const [day,v] of bins[(i+k+48)%48]){const w=(k?0.25:1)*Math.min(1,v.n/30)*2**(-(last.t-v.t)/(2*DAY));sw+=w;sum+=w*v.sum/v.n;days.add(day);}}return sw?{rate:sum/sw,days:days.size}:null;});
 if(profile.some(v=>!v))return null;
 const recent=intervals.filter(v=>v.t>=last.t-3*HOUR);let weight=0,residual=0;
 for(const v of recent){weight+=v.dt;residual+=(v.rate-profile[slot(v.t-1)].rate)*v.dt;}
 const rates=profile.map(v=>v.rate),mean=rates.reduce((a,b)=>a+b)/48,sd=Math.sqrt(rates.reduce((a,b)=>a+(b-mean)**2,0)/48),drift=Math.max(-Math.max(5,sd),Math.min(Math.max(5,sd),weight?residual/weight:0));
 let g=last.g;const path=[{t:last.t,g:Math.round(g)}];
 for(let i=1;i<=288;i++){const t=last.t+i*5*MIN,mid=t-2.5*MIN;g+=5*(profile[slot(mid)].rate+0.25*drift*Math.exp(-(mid-last.t)/(6*HOUR)));path.push({t,g:Math.round(g)});}
 return {version:VERSION,origin:last.t,gap:last.g,path,trainingFrom:rows[0].t,trainingTo:last.t,observations:rows.length,coverage,minDays:Math.min(...profile.map(p=>p.days)),maxDays:Math.max(...profile.map(p=>p.days))};
}
function predicted(model,t){if(t<model.origin||t>model.path.at(-1).t)return null;const x=(t-model.origin)/(5*MIN),i=Math.floor(x),a=model.path[i],b=model.path[Math.min(i+1,288)];return Math.round(a.g+(b.g-a.g)*(x-i));}
function compare(model,snapshots){const actual=points(snapshots).filter(p=>p.t>model.origin&&p.t<=model.path.at(-1).t);const samples=actual.map(p=>({t:p.t,actual:p.g,predicted:predicted(model,p.t),error:p.g-predicted(model,p.t)}));return {samples,mae:samples.length?samples.reduce((s,p)=>s+Math.abs(p.error),0)/samples.length:null,last:samples.at(-1)||null};}
function scheduledCutoff(t=Date.now()){return Math.floor((t+9*HOUR)/(12*HOUR))*12*HOUR-9*HOUR;}
function scheduled(snapshots,cutoff){
 if(!Number.isFinite(cutoff))return null;
 const lastTime=Math.max(...snapshots.map(s=>Date.parse(s.sourceAt)).filter(Number.isFinite));
 if(lastTime<cutoff)return null;
 const m=forecast(snapshots,cutoff);
 if(!m||cutoff-m.origin>5*MIN)return null;
 return {...m,cutoff,nextUpdate:cutoff+12*HOUR};
}
const api={forecast,points,predicted,compare,scheduledCutoff,scheduled,START,VERSION};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.MMAGapModel=api;
})(typeof globalThis!=='undefined'?globalThis:this);
