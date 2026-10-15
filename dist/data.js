/* Public live response validation and timestamp-aware session/archive merging. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.MMAData=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  function parse(payload,stamp){
    const response=payload?.response;
    if(response?.status!=='ok'||!Array.isArray(response.nominees)||response.nominees.length<6||!Number.isFinite(Date.parse(stamp)))throw new Error('Invalid Melon response');
    const ids=new Set();
    const teams=response.nominees.map(row=>{
      const id=String(row.content?.id??''),name=row.content?.name,votes=row.voteCount,reportedShare=row.votePercent;
      if(!id||!name||ids.has(id)||!Number.isSafeInteger(votes)||votes<0||!Number.isFinite(reportedShare)||reportedShare<0||reportedShare>100)throw new Error('Invalid nominee');
      ids.add(id);return {id,name,votes,reportedShare};
    });
    const totalVotes=teams.reduce((sum,t)=>sum+t.votes,0);
    if(!Number.isSafeInteger(totalVotes)||totalVotes<=0||teams.some(t=>Math.abs(t.reportedShare-100*t.votes/totalVotes)>.501))throw new Error('Invalid totals');
    teams.sort((a,b)=>b.votes-a.votes);teams.forEach((t,i)=>t.rank=i+1);
    return {sourceAt:stamp,collectedAt:stamp,origin:'melon_browser_api',totalVotes,top4:teams.slice(0,6)};
  }
  function merge(...lists){
    const rows=new Map();
    lists.flat().forEach(s=>{const t=Date.parse(s.sourceAt),key=Math.floor(t/60000),old=rows.get(key);if(!old||t>=Date.parse(old.sourceAt))rows.set(key,s);});
    return [...rows.values()].sort((a,b)=>Date.parse(a.sourceAt)-Date.parse(b.sourceAt));
  }
  function combine(archive,observations){return {...archive,snapshots:merge(archive.snapshots,observations)};}
  return {parse,merge,combine};
});
