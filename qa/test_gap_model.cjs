const assert=require('node:assert/strict'),M=require('../dist/gap-model.js'),fs=require('node:fs');
const H=3600000,start=M.START;
function snapshot(t,g){return {sourceAt:new Date(t).toISOString(),top4:[{id:'3709231',votes:100000+(t-start)/60000*100+g},{id:'994944',votes:100000+(t-start)/60000*100}]};}
const rows=Array.from({length:4*288+1},(_,i)=>snapshot(start+i*300000,-10000+i*10));
assert.equal(M.forecast(rows,start+12*H),null,'insufficient time');
const asOf=start+2*24*H,model=M.forecast(rows,asOf);assert.ok(model);assert.equal(model.path.length,145);assert.equal(model.origin,asOf);assert.equal(model.path.at(-1).t,asOf+12*H);assert.equal(model.path.at(-1).g,model.gap+1440,'constant 2 votes/min is recovered');
const poisoned=rows.map(r=>Date.parse(r.sourceAt)>asOf?snapshot(Date.parse(r.sourceAt),1e7):r);assert.deepEqual(M.forecast(poisoned,asOf),model,'future data cannot leak into training');
const firstDay=snapshot(start-300000,9e8);assert.deepEqual(M.forecast([firstDay,...rows],asOf),model,'first day excluded');
const cmp=M.compare(model,rows);assert.equal(cmp.mae,0);assert.equal(cmp.samples.length,144);assert.equal(M.predicted(model,asOf+150000),model.gap+5);
const gapped=rows.filter((r,i)=>i%24<2);assert.equal(M.forecast(gapped,asOf),null,'large gaps cannot become training increments');
const wave=Array.from({length:4*288+1},(_,i)=>{const t=start+i*300000,g=-10000+500*Math.sin(i/288*2*Math.PI);return snapshot(t,g);});const seasonal=M.forecast(wave,start+3*24*H);assert.ok(seasonal.path.some((p,i)=>i&&p.g>seasonal.path[i-1].g));assert.ok(seasonal.path.some((p,i)=>i&&p.g<seasonal.path[i-1].g),'time-of-day pattern changes direction');
console.log('Gap model: 5-minute horizon, time-of-day shape, first-day exclusion, past-only replay, exact error evaluation and missing observations passed.');
const data=JSON.parse(fs.readFileSync('dist/data/history.json'));const live=M.forecast(data.snapshots);assert.ok(live);console.log({observations:live.observations,days:[live.minDays,live.maxDays],gap:live.gap,next12h:live.path.at(-1).g});
const past=M.forecast(data.snapshots,live.origin-24*H);if(past){const c=M.compare(past,data.snapshots);console.log('12h past-only replay',{mae:Math.round(c.mae),n:c.samples.length});}
const midnight=Date.parse('2026-10-20T00:00:00+09:00'),noon=midnight+12*H;
assert.equal(M.scheduledCutoff(midnight+2.5*H),midnight);
assert.equal(M.scheduledCutoff(noon-1),midnight);
assert.equal(M.scheduledCutoff(noon),noon);
assert.equal(M.scheduledCutoff(midnight+24*H),midnight+24*H);
const fixed=M.scheduled(data.snapshots,midnight);assert.ok(fixed);assert.equal(fixed.cutoff,midnight);assert.ok(fixed.trainingTo<=midnight);assert.equal(fixed.nextUpdate,noon);
assert.deepEqual(M.scheduled([...data.snapshots,{...data.snapshots.at(-1),sourceAt:new Date(noon+H).toISOString()}],midnight),fixed,'later observations cannot change the midnight forecast');
assert.equal(M.scheduled(rows,start+10*24*H),null,'wait for the cutoff archive rather than pretend stale observations are current');
console.log('Twice-daily KST cutoffs, fixed past-only training, next update and pending data passed.');

// Legacy issues stay immutable; only the first exact scheduled 12h are compared.
const legacy={...model,cutoff:asOf,origin:asOf-300000,path:Array.from({length:289},(_,i)=>({t:asOf-300000+i*300000,g:1000+i*10}))};
const before=JSON.stringify(legacy),view=M.window12(legacy);assert.equal(view.origin,asOf);assert.equal(view.path.length,145);assert.equal(view.path.at(-1).t,asOf+12*H);assert.equal(view.gap,1010);assert.equal(JSON.stringify(legacy),before);
const scoped=M.compare(legacy,rows);assert.ok(scoped.samples.every(p=>p.t>asOf&&p.t<=asOf+12*H));assert.equal(scoped.samples.length,144);
const lagged=rows.filter(r=>Date.parse(r.sourceAt)!==asOf),aligned=M.scheduled(lagged,asOf);assert.equal(aligned.origin,asOf);assert.equal(aligned.trainingTo,asOf-300000);assert.equal(aligned.path.at(-1).t,asOf+12*H);assert.equal(aligned.path.at(-1).g,model.path.at(-1).g,'five-minute archive offset does not move scheduled endpoints');
console.log('Exact 12h scheduled boundaries, legacy 24h clipping, comparison scope and archive offset passed.');
