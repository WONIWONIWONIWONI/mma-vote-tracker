/* Restore the past-replay options shown before the combined-history UI.
   Use the original selector/model, strictly as of each cutoff. Existing issued
   paths take precedence; restored paths are then frozen in the shared ledger. */
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const SOURCE='2b47450ec8b79906f6bc14838f9b8fd9e9e2cfc6';
function restore(data,ledger,now=Date.now()){
 if(ledger.schemaVersion!==1||!Array.isArray(ledger.records))throw new Error('Invalid ledger');
 const context=vm.createContext({});for(const name of ['gap-model-v1.js','gap-selector-v1.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'legacy',name),'utf8'),context,{filename:name});
 const M=context.MMAGapModel,S=context.MMAGapSelector,original=ledger.records,records=original.slice(),first=Math.min(...original.map(r=>r.cutoff),M.scheduledCutoff(now));
 for(let cutoff=M.START+86400000;cutoff<first;cutoff+=43200000){
  if(records.some(r=>r.cutoff===cutoff))continue;
  // The old replay menu used the last already-stored issue as incumbent, not
  // recursively reconstructed earlier replays.
  const prior=original.filter(r=>r.cutoff<cutoff).sort((a,b)=>a.cutoff-b.cutoff).at(-1),model=S.select(data.snapshots,cutoff,prior?.modelId||'base');if(!model)continue;
  const inputHash=crypto.createHash('sha256').update(JSON.stringify(M.points(data.snapshots,cutoff))).digest('hex');
  records.push({...JSON.parse(JSON.stringify(model)),recordKind:'reconstructed',issuedAt:new Date(now).toISOString(),inputHash,restoredFrom:SOURCE,restoredAt:new Date(now).toISOString()});
 }
 return {...ledger,records:records.sort((a,b)=>a.cutoff-b.cutoff)};
}
if(require.main===module){const dir=path.join(__dirname,'../dist/data'),target=path.join(dir,'gap-forecasts.json'),data=JSON.parse(fs.readFileSync(path.join(dir,'history.json'))),old=JSON.parse(fs.readFileSync(target)),result=restore(data,old);fs.writeFileSync(target,JSON.stringify(result));console.log('Restored',result.records.length-old.records.length,'previous replay forecasts; total',result.records.length);}
module.exports={restore,SOURCE};
