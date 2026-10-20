/* Selection uses only completed 12h validation paths known at this issue cutoff. */
(function(root){
'use strict';
const M=typeof module!=='undefined'&&module.exports?require('./gap-model.js'):root.MMAGapModel,H=3600000,DAY=24*H,STEP=300000,VERSION='selector-v2-12h';
const CANDIDATES=[{id:'base',name:'30분 패턴·최근 보정',options:{}},{id:'no-drift',name:'30분 패턴·최근 보정 제외',options:{driftWeight:0}},{id:'fine15',name:'15분 패턴·최근 보정',options:{slotMinutes:15}},{id:'previous-day',name:'전날 동일 시간 변동',options:null}];
function interpolate(points,t){let a=null;for(const b of points){if(b.t===t)return b.g;if(b.t>t){if(!a||b.t-a.t>900000)return null;return a.g+(b.g-a.g)*(t-a.t)/(b.t-a.t);}a=b;}return null;}
function model(snapshots,cutoff,id){
 const spec=CANDIDATES.find(c=>c.id===id)||CANDIDATES[0],m=M.forecast(snapshots,cutoff,{...spec.options,origin:cutoff});if(!m||cutoff-m.origin>STEP)return null;
 if(id==='previous-day'){
  const points=M.points(snapshots,cutoff),base=interpolate(points,m.origin-DAY);if(base==null)return null;
  const path=m.path.map(p=>{const prior=interpolate(points,p.t-DAY);return prior==null?null:{t:p.t,g:Math.round(m.gap+prior-base)};});if(path.some(p=>!p))return null;m.path=path;
 }
 return {...m,cutoff,nextUpdate:cutoff+12*H,modelId:spec.id,modelName:spec.name,modelVersion:spec.id+'-v1'};
}
function decide(metrics,incumbent='base',nonOverlap=0){
 const current=metrics.find(m=>m.id===incumbent)||metrics.find(m=>m.id==='base'),best=metrics.slice().sort((a,b)=>a.score-b.score)[0];
 if(!current||!best)return {chosen:incumbent,switched:false,reason:'no-validation'};
 if(current.n<6||nonOverlap<6)return {chosen:incumbent,switched:false,reason:'insufficient-validation'};
 if(best.id===current.id)return {chosen:incumbent,switched:false,reason:'incumbent-best'};
 const improvement=current.score>0?(current.score-best.score)/current.score:0;
 if(improvement<.10||best.winRate<.60||best.endpointMAE>current.endpointMAE*1.05)return {chosen:incumbent,switched:false,reason:'improvement-not-established',improvement};
 return {chosen:best.id,switched:true,reason:'validated-improvement',improvement};
}
function select(snapshots,cutoff,incumbent='base'){
 const past=snapshots.filter(s=>Date.parse(s.sourceAt)<=cutoff),points=M.points(past,cutoff),folds=[];
 for(let origin=M.scheduledCutoff(cutoff-12*H);origin>=M.START+DAY&&folds.length<14;origin-=12*H){
  const models=CANDIDATES.map(c=>model(past,origin,c.id));if(models.some(m=>!m))continue;
  const start=models[0].origin,end=start+12*H,actual=points.filter(p=>p.t>start&&p.t<=end);if(end>cutoff||!actual.length||end-actual.at(-1).t>STEP)continue;
  const sampled=[];for(let i=1;i<=144;i++){const t=start+i*STEP;let nearest=null;for(const p of actual){if(Math.abs(p.t-t)<=STEP/2&&(!nearest||Math.abs(p.t-t)<Math.abs(nearest.t-t)))nearest=p;}if(nearest)sampled.push(nearest);}
  if(sampled.length<130)continue;
  const scores=models.map(m=>{const errors=sampled.map(p=>Math.abs(M.predicted(m,p.t)-p.g)),last=actual.at(-1),mae=errors.reduce((a,b)=>a+b)/errors.length,endpointMAE=Math.abs(M.predicted(m,last.t)-last.g);return {id:m.modelId,mae,endpointMAE,score:.7*mae+.3*endpointMAE};});
  folds.push({cutoff:origin,start,end,n:sampled.length,scores});
 }
 const metrics=CANDIDATES.map(c=>{const rows=folds.map(f=>f.scores.find(s=>s.id===c.id)),base=folds.map(f=>f.scores.find(s=>s.id===incumbent)||f.scores[0]),avg=k=>rows.length?rows.reduce((s,r)=>s+r[k],0)/rows.length:0;return {id:c.id,name:c.name,n:rows.length,mae:avg('mae'),endpointMAE:avg('endpointMAE'),score:avg('score'),winRate:rows.length?rows.filter((r,i)=>r.score<base[i].score).length/rows.length:0};});
 let nonOverlap=0,lastEnd=-Infinity;for(const f of folds.slice().sort((a,b)=>a.start-b.start)){if(f.start>=lastEnd){nonOverlap++;lastEnd=f.end;}}
 const decision=decide(metrics,incumbent,nonOverlap),chosen=model(past,cutoff,decision.chosen)||model(past,cutoff,'base');if(!chosen)return null;
 return {...chosen,selectorVersion:VERSION,selection:{...decision,chosen:chosen.modelId,incumbent,horizonHours:12,validationCount:folds.length,nonOverlap,metrics,validationCutoffs:folds.map(f=>f.cutoff),rule:'70% path MAE + 30% endpoint MAE; >=6 folds, >=6 disjoint 12h windows, >=10% improvement, >=60% wins, endpoint <=105% incumbent'}};
}
const api={model,select,decide,CANDIDATES,VERSION};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.MMAGapSelector=api;
})(typeof globalThis!=='undefined'?globalThis:this);
