const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),M=require('../dist/gap-model'),S=require('../dist/gap-selector'),F=require('../collector/forecast.cjs');
const data=JSON.parse(fs.readFileSync('dist/data/history.json')),cutoff=M.scheduledCutoff(Date.parse(data.snapshots.at(-1).sourceAt));
const selected=S.select(data.snapshots,cutoff);assert.ok(selected);assert.equal(selected.modelId,'base');assert.equal(selected.selection.reason,'insufficient-validation');assert.equal(selected.selection.validationCount,5);
assert.deepEqual(selected.path,M.scheduled(data.snapshots,cutoff).path,'current issue preserves the previously deployed path');
const future={...data.snapshots.at(-1),sourceAt:new Date(cutoff+43200000).toISOString(),top4:data.snapshots.at(-1).top4.map(t=>({...t,votes:t.votes+1e6}))};
assert.deepEqual(S.select([...data.snapshots,future],cutoff),selected,'future actuals cannot affect candidate validation or selection');
function scores(n=6){return [{id:'base',n,score:100,mae:100,endpointMAE:100,winRate:0},{id:'no-drift',n,score:80,mae:80,endpointMAE:90,winRate:.8}];}
assert.equal(S.decide(scores(5),'base',3).switched,false);assert.equal(S.decide(scores(),'base',2).switched,false);assert.equal(S.decide(scores(),'base',3).chosen,'no-drift');
let weak=scores();weak[1].score=95;assert.equal(S.decide(weak,'base',3).switched,false);
let endBad=scores();endBad[1].endpointMAE=110;assert.equal(S.decide(endBad,'base',3).switched,false);
let sporadic=scores();sporadic[1].winRate=.4;assert.equal(S.decide(sporadic,'base',3).switched,false);
let old={...selected,issuedAt:'original',inputHash:'original',recordKind:'issued'},ledger={schemaVersion:1,records:[old]};
assert.deepEqual(F.update(data,ledger,cutoff+10000000),ledger,'an issued path and metadata never change');
const last=data.snapshots.at(-1),tail=[];for(let t=Date.parse(last.sourceAt)+300000;t<=cutoff+43200000+300000;t+=300000)tail.push({...last,sourceAt:new Date(t).toISOString(),top4:last.top4.map(team=>({...team,votes:team.votes+Math.floor((t-Date.parse(last.sourceAt))/60000)*10}))});
const newData={...data,snapshots:[...data.snapshots,...tail]},next=F.update(newData,ledger,cutoff+43200000+300000);assert.equal(next.records.length,2);assert.deepEqual(next.records[0],old);assert.equal(next.records[1].cutoff,cutoff+43200000);assert.ok(next.records[1].inputHash);assert.ok(next.records[1].selection);
assert.deepEqual(F.update(newData,next,cutoff+43200000+400000),next,'same cutoff is issued once');
console.log('Adaptive selection passed: strict guards, no future leakage, legacy path preserved, immutable ledger and twice-daily issuance.');
