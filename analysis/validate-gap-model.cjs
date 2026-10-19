/* Reproducible rolling-origin diagnostics. This never changes production parameters. */
const fs=require('node:fs'),crypto=require('node:crypto'),M=require('../dist/gap-model.js');
const raw=fs.readFileSync('dist/data/history.json'),data=JSON.parse(raw),pts=M.points(data.snapshots),H=3600000,D=24*H,MIN=60000;
function at(rows,t){let i=0;while(i<rows.length&&rows[i].t<t)i++;if(rows[i]?.t===t)return rows[i];const a=rows[i-1],b=rows[i];if(!a||!b||b.t-a.t>15*MIN)return null;const k=(t-a.t)/(b.t-a.t);return {t,a:a.a+(b.a-a.a)*k,b:a.b+(b.b-a.b)*k,g:a.g+(b.g-a.g)*k};}
function profileModel(train,origin,c={}){
 const n=c.slot||30,N=1440/n,slot=t=>Math.floor(((t+9*H)%D+D)%D/(n*MIN)),bins=Array.from({length:N},()=>new Map()),recent=[];
 const last=train.at(-1);if(!last||last.t-train[0].t<D)return null;
 for(let i=1;i<train.length;i++){const a=train[i-1],b=train[i],dt=(b.t-a.t)/MIN;if(dt<=0||dt>15||b.a<a.a||b.b<a.b)continue;
  const ra=(b.a-a.a)/dt,rb=(b.b-a.b)/dt;recent.push({t:b.t,n:dt,a:ra,b:rb});
  for(let t=a.t;t<b.t;){const end=Math.min(b.t,(Math.floor((t+9*H)/(n*MIN))+1)*n*MIN-9*H),len=(end-t)/MIN,day=Math.floor((t+9*H)/D),bin=bins[slot(t)],v=bin.get(day)||{a:0,b:0,n:0,t:0,weekend:[0,6].includes(new Date(t+9*H).getUTCDay())};v.a+=ra*len;v.b+=rb*len;v.n+=len;v.t=end;bin.set(day,v);t=end;}
 }
 function rate(t){let a=0,b=0,w=0;const weekend=[0,6].includes(new Date(t+9*H).getUTCDay());for(let k=-1;k<=1;k++)for(const v of bins[(slot(t)+k+N)%N].values()){const weight=(k?(c.smooth??.25):1)*Math.min(1,v.n/n)*(c.half===Infinity?1:2**(-(origin-v.t)/((c.half||2)*D)))*(c.weekend&&v.weekend===weekend?c.weekend:1);a+=weight*v.a/v.n;b+=weight*v.b/v.n;w+=weight;}return w?{a:a/w,b:b/w}:null;}
 const profile=Array.from({length:N},(_,i)=>rate(origin-(origin+9*H)%D+i*n*MIN));if(profile.some(p=>!p))return null;
 const rs=recent.filter(r=>r.t>=origin-3*H);let weight=0,delta=0,aa=0,bb=0,ea=0,eb=0;for(const r of rs){const e=rate(r.t-1);weight+=r.n;delta+=r.n*(r.a-r.b-e.a+e.b);aa+=r.n*r.a;bb+=r.n*r.b;ea+=r.n*e.a;eb+=r.n*e.b;}
 const rates=profile.map(p=>p.a-p.b),mean=rates.reduce((a,b)=>a+b)/N,sd=Math.sqrt(rates.reduce((s,v)=>s+(v-mean)**2,0)/N),drift=Math.max(-Math.max(5,sd),Math.min(Math.max(5,sd),weight?delta/weight:0));
 let g=last.g;const path=[g];for(let i=1;i<=288;i++){const t=origin+(i-.5)*5*MIN,r=rate(t);let rateGap=r.a-r.b+(c.drift??.25)*drift*Math.exp(-(t-origin)/(6*H));if(c.scale){const scale=x=>Math.max(.5,Math.min(1.5,x));const fa=ea?scale(aa/ea):1,fb=eb?scale(bb/eb):1,decay=Math.exp(-(t-origin)/(6*H));rateGap=r.a*(1+(fa-1)*decay)-r.b*(1+(fb-1)*decay);}g+=5*rateGap;path.push(g);}
 return t=>{const x=(t-origin)/(5*MIN),i=Math.floor(x);if(i<0||i>288)return null;return path[i]+((path[Math.min(288,i+1)]??path[i])-path[i])*(x-i);};
}
function observed(rows,t,maxTime=Infinity){let best=null;for(const p of rows){if(p.t>maxTime)break;if(Math.abs(p.t-t)<=2.5*MIN&&(!best||Math.abs(p.t-t)<Math.abs(best.t-t)))best=p;}return best;}
const names={ensemble:'현재+전날 50:50',balanced:'보정제외+전날 50:50',current:'현재 모델',unchanged:'현재 표차 유지',linear6:'최근 6시간 직선',yesterday:'전날 동일 시간 변동',nodrift:'시간대 평균·최근 보정 없음',recent:'최근 날짜 가중 강화',uniform:'날짜 동일 가중',hourly:'1시간 패턴',fifteen:'15분 패턴',shrink:'현재 모델 변동폭 75%',teamScaled:'팀별 최근 속도 보정',weekday:'평일·주말 가중(탐색)'};
const results=[];
for(let cutoff=M.START+D;cutoff<=pts.at(-1).t;cutoff+=12*H){const base=M.scheduled(data.snapshots,cutoff);if(!base)continue;const origin=base.origin,train=pts.filter(p=>p.t<=origin),last=train.at(-1),a6=at(train,origin-6*H),aday=at(train,origin-D);
 const models={current:t=>M.predicted(base,t),unchanged:()=>last.g,linear6:t=>a6?last.g+(last.g-a6.g)*(t-origin)/(6*H):null,yesterday:t=>{const p=at(train,t-D);return aday&&p?last.g+p.g-aday.g:null;},nodrift:profileModel(train,origin,{drift:0}),recent:profileModel(train,origin,{half:.5}),uniform:profileModel(train,origin,{half:Infinity}),hourly:profileModel(train,origin,{slot:60}),fifteen:profileModel(train,origin,{slot:15}),shrink:t=>last.g+.75*(M.predicted(base,t)-last.g),teamScaled:profileModel(train,origin,{scale:true}),weekday:profileModel(train,origin,{weekend:2})};
 models.ensemble=t=>{const a=models.current(t),b=models.yesterday(t);return a==null||b==null?null:(a+b)/2;};models.balanced=t=>{const a=models.nodrift?.(t),b=models.yesterday(t);return a==null||b==null?null:(a+b)/2;};
 for(const horizon of [6,12,24]){const target=origin+horizon*H;if(pts.at(-1).t<target)continue;const samples=[];
  for(let t=origin+5*MIN;t<=target;t+=5*MIN){const actual=observed(pts,t,target);if(!actual)continue;const preds=Object.fromEntries(Object.entries(models).map(([k,fn])=>[k,fn?.(actual.t)]));if(Object.values(preds).some(v=>v===null||!Number.isFinite(v)))continue;samples.push({t:actual.t,actual:actual.g,preds});}
  if(samples.length<horizon*12*.9)continue;
  const end=pts.filter(p=>p.t<=target&&target-p.t<=5*MIN).at(-1),score={};for(const key of Object.keys(models)){const err=samples.map(p=>p.preds[key]-p.actual);score[key]={mae:err.reduce((s,e)=>s+Math.abs(e),0)/err.length,rmse:Math.sqrt(err.reduce((s,e)=>s+e*e,0)/err.length),endpoint:end?models[key](end.t)-end.g:null,bias:err.reduce((s,e)=>s+e,0)/err.length};}
  results.push({cutoff:new Date(cutoff).toISOString(),origin:new Date(origin).toISOString(),horizon,samples:samples.length,score});
 }
}
function aggregate(rows){return Object.keys(names).map(k=>{const r=rows.map(x=>x.score[k]),end=r.map(x=>x.endpoint).filter(Number.isFinite);return {model:k,name:names[k],origins:r.length,mae:r.length?r.reduce((s,x)=>s+x.mae,0)/r.length:null,endpointMAE:end.length?end.reduce((s,x)=>s+Math.abs(x),0)/end.length:null,bias:r.length?r.reduce((s,x)=>s+x.bias,0)/r.length:null};}).sort((a,b)=>a.mae-b.mae);}
const report={generatedAt:new Date().toISOString(),dataThrough:data.snapshots.at(-1).sourceAt,sha256:crypto.createHash('sha256').update(raw).digest('hex'),excludedBefore:new Date(M.START).toISOString(),totalPaired:pts.length,names,results,summaries:Object.fromEntries([6,12,24].map(h=>[h,aggregate(results.filter(r=>r.horizon===h))])),nonoverlapMidnight24:aggregate(results.filter(r=>r.horizon===24&&new Date(Date.parse(r.cutoff)+9*H).getUTCHours()===0))};
fs.writeFileSync('analysis/gap-validation-20261020.json',JSON.stringify(report,null,2));
console.log('data',report.dataThrough,'paired',pts.length);for(const h of [6,12,24]){console.log('\nHorizon',h);console.table(report.summaries[h].map(r=>({model:r.model,n:r.origins,MAE:Math.round(r.mae),endMAE:Math.round(r.endpointMAE),bias:Math.round(r.bias)})));}console.log('nonoverlap midnight 24h');console.table(report.nonoverlapMidnight24.map(r=>({model:r.model,n:r.origins,MAE:Math.round(r.mae)})));
