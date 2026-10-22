/* Board-safe HTML uses normal flow and tables; no positioned layers or images. */
(() => {
  "use strict";
  const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
  const n = v => Math.round(Number(v) * 10) / 10;
  const transparent = c => !c || c === "none" || c === "transparent" || c === "rgba(0, 0, 0, 0)";
  const color = c => /^#[\da-f]{3,8}$/i.test(c) ? c : "#a4adbf";
  function rgb(value) {
    if (/^#[\da-f]{6}$/i.test(value)) return value;
    const a = value.match(/[\d.]+/g)?.map(Number);
    if(!a || a.length<3)return "#a4adbf";
    const alpha=a[3]??1, bg=[25,23,37];
    return "#"+a.slice(0,3).map((v,i)=>Math.round(v*alpha+bg[i]*(1-alpha)).toString(16).padStart(2,"0")).join("");
  }
  const table = (content, extra = "") => `<table width="100%" cellspacing="0" cellpadding="0" border="0" ${extra} style="width:100%;border-collapse:collapse;table-layout:fixed;font-family:Arial,sans-serif;color:#f5f6fa;">${content}</table>`;
  const cell = (body, extra = "") => `<td valign="top" ${extra}>${body}</td>`;
  function leaders(model, edition, mobile) {
    const cards=model.leaders.map((t,i)=> {
      const c=color(t.color), bg=i===0?"#352034":"#191725";
      const body=table(`<tr>${cell(`<font color="${c}"><b>${String(t.rank).padStart(2,"0")}</b></font> <font color="#a4adbf">RANK</font>`)}${cell(i===0?'<font color="#e6ff54">현재 선두</font>':"",'align="right"')}</tr>`)+
        `<p style="font-size:20px;font-weight:bold;margin:20px 0 12px;"><font color="${c}">●</font> ${esc(t.name)}</p>`+
        table(`<tr>${cell(`<b style="font-size:32px;">${esc(t.votes.replace(/표$/,""))}</b> <font color="#a4adbf">표</font>`)}${cell(`<font color="${c}" style="font-size:24px;">${esc(t.share)}</font>`,'align="right"')}</tr>`)+
        `<p style="border-top:1px solid #41374f;padding-top:14px;margin-top:20px;"><font color="#a4adbf">전체 투표 중 점유율</font></p><p style="font-size:12px;color:${i===0?"#ff789a":"#a4adbf"};">${esc(t.gap)}</p>`;
      return cell(`<font color="#f5f6fa">${body}</font>`,`bgcolor="${bg}" width="${mobile?100:50}%" style="padding:20px;border:1px solid ${i===0?"#98456a":"#393346"};border-radius:14px;"`);
    });
    const count=mobile?1:2, rows=[];
    for(let i=0;i<cards.length;i+=count)rows.push(`<tr>${cards.slice(i,i+count).join("")}</tr>`);
    return table(`<tr>${cell(`<font color="#ff789a">VOTE/TRACK · ${esc(edition)}</font><p style="font-size:12px;color:#a4adbf;">${esc(model.sourceAt)} KST</p>`,'style="padding:12px;"')}</tr><tr>${cell(`<table width="100%" cellspacing="12" cellpadding="0" border="0" style="width:100%;table-layout:fixed;border-spacing:12px;">${rows.join("")}</table>`)}</tr>`,'bgcolor="#100e19"');
  }
  // Convert currently displayed chart geometry to run-length-compressed table cells.
  // Cell colors are HTML attributes, so removing positioning CSS cannot scatter it.
  function chart(svg, columns=160, rows=96) {
    const vb=svg.viewBox.baseVal, W=vb.width || svg.clientWidth, H=vb.height || svg.clientHeight;
    const clip=svg.querySelector("clipPath rect"), a=k=>Number(clip?.getAttribute(k)||0);
    const area=clip?{x:a("x"),y:a("y"),w:a("width"),h:a("height")}:{x:60,y:12,w:W-80,h:H-54};
    const grid=Array.from({length:rows},()=>Array(columns).fill(null));
    const map=(x,y)=>({x:Math.round((x-area.x)/area.w*(columns-1)),y:Math.round((y-area.y)/area.h*(rows-1))});
    const put=(x,y,c)=>{if(x>=0&&x<columns&&y>=0&&y<rows)grid[y][x]=c;};
    function segment(A,B,c,dashed,phase=0) {
      let x=A.x,y=A.y, dx=Math.abs(B.x-x),dy=-Math.abs(B.y-y),sx=x<B.x?1:-1,sy=y<B.y?1:-1,err=dx+dy,steps=0;
      // A path can begin outside a zoom window; cap work without joining gaps.
      if(Math.abs(x)>100000 || Math.abs(y)>100000 || Math.abs(B.x)>100000 || Math.abs(B.y)>100000)return;
      for(let limit=0;limit<200000;limit++){
        if(!dashed || (steps+phase)%5<3)put(x,y,c);
        if(x===B.x&&y===B.y)break;
        const e=2*err;if(e>=dy){err+=dy;x+=sx;}if(e<=dx){err+=dx;y+=sy;}steps++;
      }
      return steps;
    }
    for(const node of svg.querySelectorAll("path,line,rect,circle")) {
      if(node.closest("defs"))continue;
      const s=getComputedStyle(node);if(s.display==="none"||s.visibility==="hidden"||Number(s.opacity)===0)continue;
      const tag=node.tagName.toLowerCase(), num=k=>Number(node.getAttribute(k)||0);
      if(tag==="path" && !transparent(s.stroke)){
        const commands=(node.getAttribute("d")||"").match(/[ML][^ML]*/gi)||[];let last=null,phase=0;
        for(const cmd of commands){const nums=cmd.slice(1).match(/-?(?:\d*\.)?\d+(?:e[-+]?\d+)?/gi)||[];if(cmd[0].toUpperCase()==="M"){last=null;phase=0;}
          for(let i=0;i+1<nums.length;i+=2){const p=map(+nums[i],+nums[i+1]);if(last)phase+=segment(last,p,rgb(s.stroke),s.strokeDasharray!=="none",phase)||0;last=p;}
        }
      } else if(tag==="line" && !transparent(s.stroke)) segment(map(num("x1"),num("y1")),map(num("x2"),num("y2")),rgb(s.stroke),s.strokeDasharray!=="none");
      else if(tag==="rect" && !transparent(s.fill)){
        const p=map(num("x"),num("y")),q=map(num("x")+num("width"),num("y")+num("height"));
        for(let y=Math.max(0,p.y);y<=Math.min(rows-1,q.y);y++)for(let x=Math.max(0,p.x);x<=Math.min(columns-1,q.x);x++)put(x,y,rgb(s.fill));
      } else if(tag==="circle" && !transparent(s.fill)){const p=map(num("cx"),num("cy"));put(p.x,p.y,rgb(s.fill));}
    }
    const text=[...svg.querySelectorAll("text")].map(t=>({x:Number(t.getAttribute("x")),y:Number(t.getAttribute("y")),text:t.textContent}));
    const ticks=text.filter(t=>t.x<area.x && t.y>=area.y-4 && t.y<=area.y+area.h+8).sort((a,b)=>a.y-b.y);
    const labels=text.filter(t=>t.y>area.y+area.h+8).sort((a,b)=>a.x-b.x);
    const annotations=text.filter(t=>!ticks.includes(t)&&!labels.includes(t)).map(t=>t.text);
    const rowHeight=Math.max(2,Math.round(264/rows));
    const cells=grid.map(row=>{let html="";for(let x=0;x<columns;){let end=x+1;while(end<columns&&row[end]===row[x])end++;
      html+=`<td${end-x>1?` colspan="${end-x}"`:""}${row[x]?` bgcolor="${row[x]}"`:""}></td>`;x=end;}
      return `<tr height="${rowHeight}" style="height:${rowHeight}px;">${html}</tr>`;
    }).join("");
    const columnsHTML=`<colgroup>${Array.from({length:columns},()=>`<col width="${(100/columns).toFixed(4)}%">`).join("")}</colgroup>`;
    const plot=`<table width="100%" height="${rows*rowHeight}" bgcolor="#191725" cellspacing="0" cellpadding="0" border="0" style="width:100%;height:${rows*rowHeight}px;table-layout:fixed;border-collapse:collapse;font-size:0;line-height:0;">${columnsHTML}<tbody>${cells}</tbody></table>`;
    const axis=`<table width="100%" height="${rows*rowHeight}" cellspacing="0" cellpadding="0" border="0">${ticks.map(t=>`<tr><td align="right" valign="middle"><font color="#a4adbf" style="font-size:10px;">${esc(t.text)}</font></td></tr>`).join("")}</table>`;
    const bottom=table(`<tr>${labels.map(t=>cell(`<font color="#a4adbf" style="font-size:9px;">${esc(t.text)}</font>`,'align="center"')).join("")}</tr>`);
    return `<div><p style="font-size:11px;color:#a4adbf;">${annotations.map(esc).join(" · ")}</p>${table(`<tr>${cell(axis,'width="60"')}${cell(plot+bottom)}</tr>`)}</div>`;
  }
  function panel(stage, columns=160, rows=96) {
    const rootStyle=getComputedStyle(stage);
    function flow(node) {
      if(node.nodeType===Node.TEXT_NODE)return esc(node.textContent.replace(/\s+/g," "));
      if(!(node instanceof Element))return "";
      const s=getComputedStyle(node);
      if(node.hidden||s.display==="none"||s.visibility==="hidden"||["SCRIPT","STYLE","IFRAME","CANVAS","IMG"].includes(node.tagName))return "";
      if(node instanceof SVGSVGElement)return chart(node,columns,rows);
      if(node instanceof HTMLSelectElement)return `<b>${esc(node.selectedOptions[0]?.textContent)}</b>`;
      if(node instanceof HTMLInputElement)return node.type==="checkbox"?(node.checked?"☑":"☐"):esc(node.value);
      if(node.tagName==="BR")return "<br>";
      let style=`color:${s.color};font-size:${s.fontSize};font-weight:${s.fontWeight};line-height:1.5;`;
      if(!transparent(s.backgroundColor))style+=`background-color:${s.backgroundColor};`;
      if(parseFloat(s.padding))style+=`padding:${s.padding};`;
      if(parseFloat(s.borderTopWidth)>0&&s.borderTopStyle!=="none")style+=`border:1px solid ${s.borderTopColor};`;
      if(parseFloat(s.borderRadius))style+=`border-radius:${s.borderRadius};`;
      const children=[...node.childNodes].filter(c=>c.nodeType!==Node.TEXT_NODE||c.textContent.trim());
      if(!children.length){
        if(transparent(s.backgroundColor))return "";
        const parentWidth=node.parentElement?.getBoundingClientRect().width||1;
        const width=Math.min(100,Math.max(1,node.getBoundingClientRect().width/parentWidth*100));
        return `<table width="${n(width)}%" cellspacing="0" cellpadding="0" border="0"><tr><td bgcolor="${rgb(s.backgroundColor)}" height="4" style="height:4px;font-size:0;line-height:0;"></td></tr></table>`;
      }
      let content;
      const elements=children.filter(c=>c instanceof Element);
      if((s.display.includes("flex")&&s.flexDirection!=="column" || s.display.includes("grid")) && elements.length>1 && elements.length===children.length){
        const grouped=[];for(const child of elements){const top=child.getBoundingClientRect().top;let row=grouped.find(r=>Math.abs(r.top-top)<4);if(!row){row={top,nodes:[]};grouped.push(row);}row.nodes.push(child);}
        const max=Math.max(...grouped.map(r=>r.nodes.length));
        content=table(grouped.map(r=>`<tr>${r.nodes.map(child=>cell(flow(child),`width="${n(100/max)}%" style="padding:4px;"`)).join("")}</tr>`).join(""));
      }else content=children.map(flow).join("");
      const tag=["SPAN","B","STRONG","SMALL","EM","LABEL","I"].includes(node.tagName)?"span":"div";
      return `<${tag} style="${esc(style)}">${content}</${tag}>`;
    }
    return table(`<tr>${cell(`<font color="${rgb(rootStyle.color)}">${[...stage.childNodes].map(flow).join("")}</font>`,'style="padding:16px;font:14px/1.5 Arial,sans-serif;"')}</tr>`,`bgcolor="${rgb(rootStyle.backgroundColor)}"`);
  }
  function hourly(model, edition) {
    const teams=model.rows[0]?.values||[];
    const rows=model.rows.map(row=>{
      const valid=row.values.filter(v=>v.delta!=null), same=new Set(valid.map(v=>v.from+":"+v.to)).size===1;
      const max=Math.max(0,...valid.map(v=>v.delta)), winners=same&&max>0?valid.filter(v=>v.delta===max):[];
      const scale=Math.max(1,...valid.map(v=>Math.abs(v.delta)));
      return `<tr><td style="padding:14px 10px;background:#1a1e2b;vertical-align:top;"><b>${esc(row.label)}</b><br><small style="color:#f2aac2">${esc(winners.length?winners.map(v=>v.name).join(" · "):"구간 다름 / 기록 대기")}</small><br><small style="color:#a4adbf">${esc(row.status)}</small></td>${row.values.map(v=>`<td style="padding:14px 6px;background:#1a1e2b;vertical-align:top;"><b${winners.includes(v)?' style="color:#ff789a"':""}>${esc(v.label)}</b><div style="height:4px;width:${n(Math.abs(v.delta??0)/scale*100)}%;background:${color(v.color)};margin:8px 0;"></div>${v.coverage?`<small style="color:#a4adbf;font-size:9px;overflow-wrap:anywhere;">${esc(v.coverage)}</small>`:""}</td>`).join("")}</tr>`;
    }).join("");
    return `<div style="padding:24px;background:#10121b;color:#f5f6fa;font:13px/1.6 system-ui,sans-serif;text-align:left;overflow-x:auto;"><p style="color:#f2aac2;margin:0;">VOTE/TRACK · ${esc(edition)}</p><p style="color:#a4adbf;font-size:10px;">최신 관측 ${esc(model.sourceAt)} KST</p><h2 style="color:#f5f6fa;font-size:24px;margin:18px 0;">${esc(model.title)}</h2><p style="color:#a4adbf;">${esc(model.subtitle)}</p><table style="width:100%;min-width:720px;table-layout:fixed;border-collapse:separate;border-spacing:0 8px;color:inherit;font:inherit;"><colgroup><col style="width:22%;">${teams.map(()=>'<col style="width:13%;">').join("")}</colgroup><thead><tr><th style="text-align:left;color:#a4adbf;">시간 / 관측 최다</th>${teams.map(t=>`<th style="text-align:left;font-size:11px;color:${color(t.color)};">${esc(t.name)}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table><p style="color:#a4adbf;font-size:10px;">데이터 출처 Melon · 비공식 팬 대시보드 · 모든 시각 KST</p></div>`;
  }
  window.MMANativeHTML={panel,hourly,leaders};
})();
