/* Static, selectable HTML/CSS snapshots. No images, SVG, canvas or scripts. */
(() => {
  "use strict";
  const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
  const n = v => Math.round(Number(v) * 10) / 10;
  const px = v => n(v) + "px";
  const transparent = c => !c || c === "none" || c === "transparent" || c === "rgba(0, 0, 0, 0)";
  const color = c => /^#[\da-f]{3,8}$/i.test(c) ? c : "#a4adbf";
  const box = (r, origin) => `position:absolute;left:${px(r.left-origin.left)};top:${px(r.top-origin.top)};width:${px(r.width)};height:${px(r.height)};`;
  const element = (style, content = "") => `<div style="${esc(style)}">${content}</div>`;
  function textStyle(s, base) {
    let css = "white-space:pre-wrap;overflow-wrap:normal;";
    for (const [p, key] of [["font-size","fontSize"],["font-weight","fontWeight"],["font-style","fontStyle"],["line-height","lineHeight"],["letter-spacing","letterSpacing"],["text-transform","textTransform"],["color","color"]])
      if (s[key] !== base[key]) css += `${p}:${s[key]};`;
    return css;
  }
  // Ramer–Douglas–Peucker in display pixels; values and text are never rounded.
  function simplify(points, epsilon = .25) {
    if (points.length < 3) return points;
    const keep = new Set([0, points.length-1]), stack = [[0,points.length-1]];
    while (stack.length) {
      const [a,b] = stack.pop(), A=points[a], B=points[b], dx=B.x-A.x, dy=B.y-A.y, l=dx*dx+dy*dy;
      let max=epsilon*epsilon, index=-1;
      for(let i=a+1;i<b;i++) {
        const P=points[i], t=l ? Math.max(0,Math.min(1,((P.x-A.x)*dx+(P.y-A.y)*dy)/l)) : 0;
        const d=(P.x-A.x-t*dx)**2+(P.y-A.y-t*dy)**2;
        if(d>max){max=d;index=i;}
      }
      if(index>=0){keep.add(index);stack.push([a,index],[index,b]);}
    }
    return [...keep].sort((a,b)=>a-b).map(i=>points[i]);
  }
  function stroke(points, width, paint, bounds, dashed) {
    if(points.length < 2) return "";
    points=simplify(points);
    const sides = [[],[]];
    points.forEach((p,i)=>{
      const a=points[Math.max(0,i-1)], b=points[Math.min(points.length-1,i+1)], d=Math.hypot(b.x-a.x,b.y-a.y)||1;
      for(let side=0;side<2;side++) {
        const k=(side ? -1 : 1)*width/2;
        sides[side].push(`${px(p.x-(b.y-a.y)/d*k)} ${px(p.y+(b.x-a.x)/d*k)}`);
      }
    });
    return element(`position:absolute;inset:0;background:${dashed ? `repeating-linear-gradient(90deg,${paint} 0 5px,transparent 5px 9px)` : paint};clip-path:polygon(${[...sides[0],...sides[1].reverse()].join(",")});`);
  }
  function svgHTML(svg, origin, base) {
    const r=svg.getBoundingClientRect();
    function draw(node) {
      if (!(node instanceof SVGElement)) return "";
      const tag=node.tagName.toLowerCase(), s=getComputedStyle(node);
      if (["defs","title","desc","clippath"].includes(tag) || s.display === "none" || s.visibility === "hidden") return "";
      const ctm=node.getScreenCTM();
      if (!ctm) return "";
      const point=(x,y)=>({x:ctm.a*x+ctm.c*y+ctm.e-r.left,y:ctm.b*x+ctm.d*y+ctm.f-r.top});
      const scale=Math.hypot(ctm.a,ctm.b), width=parseFloat(s.strokeWidth)*scale;
      const attr=k=>Number(node.getAttribute(k)||0);
      let html="";
      if(tag === "g") {
        html=[...node.children].map(draw).join("");
        const id=/url\(["']?(?:[^#]*#)([^)"']+)/.exec(s.clipPath)?.[1];
        const clip=id && svg.querySelector(`[id="${CSS.escape(id)}"] rect`);
        if(clip){
          // Geometry in defs has no rendered bounding box; use user-space coordinates.
          const x=Number(clip.getAttribute("x")||0), y=Number(clip.getAttribute("y")||0);
          const a=point(x,y), b=point(x+Number(clip.getAttribute("width")),y+Number(clip.getAttribute("height")));
          html=element(`position:absolute;inset:0;overflow:hidden;clip-path:inset(${px(a.y)} ${px(r.width-b.x)} ${px(r.height-b.y)} ${px(a.x)});`,html);
        }
      } else if(tag === "path") {
        if (!transparent(s.stroke)) {
          // Current charts contain M/L paths; keep each missing-data break separate.
          const commands=(node.getAttribute("d")||"").match(/[ML][^ML]*/gi)||[];
          let points=[];
          const finish=()=>{html+=stroke(points,width,s.stroke,r,s.strokeDasharray!=="none");points=[];};
          for(const command of commands){if(command[0].toUpperCase()==="M")finish();const nums=command.slice(1).match(/-?(?:\d*\.)?\d+(?:e[-+]?\d+)?/gi)||[];for(let i=0;i+1<nums.length;i+=2)points.push(point(+nums[i],+nums[i+1]));}
          finish();
        }
      } else if(tag === "line") {
        const a=point(attr("x1"),attr("y1")), b=point(attr("x2"),attr("y2")), len=Math.hypot(b.x-a.x,b.y-a.y), dash=s.strokeDasharray!=="none";
        html=element(`position:absolute;left:${px(a.x)};top:${px(a.y-width/2)};width:${px(len)};height:${px(width)};transform-origin:0 50%;transform:rotate(${n(Math.atan2(b.y-a.y,b.x-a.x)*180/Math.PI)}deg);${dash ? `border-top:${px(width)} dashed ${s.stroke};box-sizing:border-box;` : `background:${s.stroke};`}`);
      } else if(tag === "rect" || tag === "circle") {
        const br=node.getBoundingClientRect();
        if(!transparent(s.fill)) html=element(box(br,r)+`background:${s.fill};${tag==="circle" ? "border-radius:50%;" : ""}`);
      } else if(tag === "text") {
        const br=node.getBoundingClientRect();
        html=element(box(br,r)+`font-size:${px(parseFloat(s.fontSize)*scale)};line-height:1.2;white-space:nowrap;color:${s.fill};font-weight:${s.fontWeight};`,esc(node.textContent));
      }
      if(html && s.opacity!=="1") html=element(`position:absolute;inset:0;opacity:${s.opacity};`,html);
      return html;
    }
    return element(box(r,origin)+"overflow:hidden;",[...svg.children].map(draw).join(""));
  }
  function panel(stage) {
    const origin=stage.getBoundingClientRect(), base=getComputedStyle(stage);
    const blocks=[];
    function visit(node) {
      if(node.nodeType === Node.TEXT_NODE) {
        if(!node.textContent.trim()) return;
        const parent=node.parentElement, s=getComputedStyle(parent);
        const range=document.createRange();range.selectNodeContents(node);
        const r=range.getBoundingClientRect();
        if(r.width && r.height) blocks.push(element(box(r,origin)+textStyle(s,base),esc(node.textContent.replace(/\s+/g," "))));
        return;
      }
      if(!(node instanceof Element))return;
      const s=getComputedStyle(node);
      if(s.display==="none" || s.visibility==="hidden" || node.hidden)return;
      if(node instanceof SVGSVGElement){blocks.push(svgHTML(node,origin,base));return;}
      if(["SCRIPT","STYLE","IFRAME","CANVAS","IMG"].includes(node.tagName))return;
      const r=node.getBoundingClientRect();
      let css="";
      if(!transparent(s.backgroundColor))css+=`background:${s.backgroundColor};`;
      if(s.backgroundImage!=="none" && !s.backgroundImage.includes("url("))css+=`background-image:${s.backgroundImage};`;
      for(const edge of ["Top","Right","Bottom","Left"])
        if(parseFloat(s[`border${edge}Width`])>0 && s[`border${edge}Style`]!=="none")css+=`border-${edge.toLowerCase()}:${s[`border${edge}Width`]} ${s[`border${edge}Style`]} ${s[`border${edge}Color`]};`;
      if(css){css+="box-sizing:border-box;";if(parseFloat(s.borderRadius))css+=`border-radius:${s.borderRadius};`;blocks.push(element(box(r,origin)+css));}
      if(node instanceof HTMLSelectElement){blocks.push(element(box(r,origin)+textStyle(s,base)+"display:flex;align-items:center;padding-left:8px;box-sizing:border-box;",esc(node.selectedOptions[0]?.textContent)));return;}
      if(node instanceof HTMLInputElement){if(node.type==="checkbox")blocks.push(element(box(r,origin)+"color:#f5f6fa;",node.checked?"☑":"☐"));return;}
      for(const child of node.childNodes)visit(child);
    }
    for(const child of stage.childNodes)visit(child);
    return `<div style="max-width:100%;overflow-x:auto;background:${esc(base.backgroundColor)}"><div style="position:relative;width:${px(origin.width)};height:${px(stage.scrollHeight)};font:14px/1.5 system-ui,sans-serif;color:${esc(base.color)};text-align:left;">${blocks.join("")}</div></div>`;
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
  window.MMANativeHTML={panel,hourly};
})();
