const assert=require('node:assert/strict'),M=require('../dist/gap-model'),G=require('../dist/gap-history');
const H=3600000,t=M.START+24*H;
const record=(cutoff,g=100)=>({version:M.VERSION,cutoff,origin:cutoff,gap:g,path:Array.from({length:145},(_,i)=>({t:cutoff+i*300000,g:g+i}))});
const a=record(t),b=record(t+12*H,999),c=record(t+24*H),input=[c,b,a];
const before=JSON.stringify(input),initial=G.build(input,t+23*H);assert.equal(initial.models.length,1);assert.equal(initial.end,t+12*H);
const completed=G.build(input,t+24*H);assert.equal(completed.models.length,2);assert.equal(completed.segments.length,1);assert.equal(completed.start,t);assert.equal(completed.end,t+24*H);assert.equal(completed.segments[0][144].g,244);assert.equal(completed.segments[0][145].g,999,'new baseline is connected without changing the old endpoint');
assert.equal(JSON.stringify(input),before,'archived predictions are never refit or mutated');assert.equal(G.build([a,c],t+36*H).segments.length,2,'unpublished gaps are not invented');
const snapshots=Array.from({length:433},(_,i)=>({sourceAt:new Date(t+i*300000).toISOString(),top4:[{id:'3709231',votes:20000+i},{id:'994944',votes:10000}]}));
const cmp=G.compare(completed,snapshots);assert.equal(cmp.samples.length,288);assert.ok(cmp.samples.every(s=>s.t>t&&s.t<=t+24*H));assert.equal(new Set(cmp.samples.map(s=>s.t)).size,288,'issue boundaries do not double-count observations');
assert.deepEqual(G.clamp([t-4*H,t+8*H],t,t+24*H),[t,t+12*H]);assert.deepEqual(G.clamp([t+20*H,t+32*H],t,t+24*H),[t+12*H,t+24*H]);
console.log('Public forecast history: completed-only rollover, immutable connected paths, gaps, fair error comparison and viewport bounds passed.');
// Restore every earlier replay menu entry with its original model version.
const fs=require('node:fs'),R=require('../collector/restore_forecast_history.cjs'),data=JSON.parse(fs.readFileSync('dist/data/history.json')),stored=JSON.parse(fs.readFileSync('dist/data/gap-forecasts.json')),original={...stored,records:stored.records.filter(r=>!r.restoredFrom)},now=Date.parse(data.snapshots.at(-1).sourceAt),restored=R.restore(data,original,now),backfilled=restored.records.filter(r=>r.restoredFrom);
assert.equal(backfilled.length,6,'all six formerly selectable past replays are restored');
for(const record of original.records)assert.deepEqual(restored.records.find(r=>r.cutoff===record.cutoff),record,'existing published forecasts remain unchanged');
for(const record of backfilled){assert.ok(record.trainingTo<=record.cutoff);assert.deepEqual(record.path,stored.records.find(r=>r.cutoff===record.cutoff).path,'restored path matches the original past-only model');}
const lastRestored=backfilled.at(-1).cutoff,poisoned={...data,snapshots:data.snapshots.map(s=>Date.parse(s.sourceAt)<=lastRestored?s:{...s,top4:s.top4.map(t=>({...t,votes:t.votes+999999}))})};
assert.deepEqual(R.restore(poisoned,original,now),restored,'future observations never influence restored forecasts');
assert.deepEqual(R.restore(data,stored,now),stored,'restoration never replaces frozen records');
const joined=G.build(stored.records,now);assert.ok(joined.models.length>=7);assert.equal(joined.segments.length,1,'all seven completed past predictions share one cumulative path');assert.equal(joined.start,M.START+86400000);
console.log('All previous replay forecasts restored, no future leakage, original issues unchanged, seven completed issues joined.');
