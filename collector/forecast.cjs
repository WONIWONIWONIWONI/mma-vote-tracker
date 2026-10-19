/* Immutable twice-daily forecast ledger. Called by the existing collector. */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),M=require('../dist/gap-model.js'),S=require('../dist/gap-selector.js');
function update(data,ledger={schemaVersion:1,records:[]},now=Date.now()){
 if(ledger.schemaVersion!==1||!Array.isArray(ledger.records))throw new Error('Invalid forecast ledger');
 const records=ledger.records.slice(),lastTime=Date.parse(data.snapshots.at(-1).sourceAt),latest=M.scheduledCutoff(Math.min(now,lastTime));
 let next=records.length?Math.max(...records.map(r=>r.cutoff))+43200000:latest;
 for(;next<=latest;next+=43200000){if(records.some(r=>r.cutoff===next))continue;
  const previous=records.filter(r=>r.cutoff<next).sort((a,b)=>a.cutoff-b.cutoff).at(-1),m=S.select(data.snapshots,next,previous?.modelId||'base');if(!m)continue;
  const input=M.points(data.snapshots,next),inputHash=crypto.createHash('sha256').update(JSON.stringify(input)).digest('hex');
  records.push({...m,issuedAt:new Date(now).toISOString(),recordKind:now-next<=900000?'issued':'reconstructed',inputHash});
 }
 return {...ledger,records:records.sort((a,b)=>a.cutoff-b.cutoff)};
}
if(require.main===module){const root=path.resolve(__dirname,'..'),target=path.join(root,'dist/data/gap-forecasts.json'),data=JSON.parse(fs.readFileSync(path.join(root,'dist/data/history.json'))),old=fs.existsSync(target)?JSON.parse(fs.readFileSync(target)):{schemaVersion:1,records:[]},result=update(data,old);if(result.records.length!==old.records.length){fs.writeFileSync(target+'.tmp',JSON.stringify(result));fs.renameSync(target+'.tmp',target);console.log('Stored scheduled forecast:',result.records.at(-1).cutoff,result.records.at(-1).modelId);}}
module.exports={update};
