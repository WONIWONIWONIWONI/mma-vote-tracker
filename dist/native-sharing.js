/* Board-safe HTML uses normal flow and tables; no positioned layers or images. */
(() => {
  "use strict";
  const esc = (v) =>
    String(v ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  const n = (v) => Math.round(Number(v) * 10) / 10;
  const transparent = (c) =>
    !c || c === "none" || c === "transparent" || c === "rgba(0, 0, 0, 0)";
  const color = (c) => (/^#[\da-f]{3,8}$/i.test(c) ? c : "#b0b4ba");
  function rgb(value) {
    if (/^#[\da-f]{6}$/i.test(value)) return value;
    const a = value.match(/[\d.]+/g)?.map(Number);
    if (!a || a.length < 3) return "#b0b4ba";
    const alpha = a[3] ?? 1,
      bg = [24, 25, 27];
    return (
      "#" +
      a
        .slice(0, 3)
        .map((v, i) =>
          Math.round(v * alpha + bg[i] * (1 - alpha))
            .toString(16)
            .padStart(2, "0"),
        )
        .join("")
    );
  }
  const table = (content, extra = "") =>
    `<table width="100%" cellspacing="0" cellpadding="0" border="0" ${extra} style="width:100%;border-collapse:collapse;table-layout:fixed;font-family:Arial,sans-serif;color:#edeef0;">${content}</table>`;
  const cell = (body, extra = "") => `<td valign="top" ${extra}>${body}</td>`;
  function leaders(model, edition) {
    const cards = model.leaders.map((t, i) => {
      const c = color(t.color),
        bg = "#18191b";
      const body =
        table(
          `<tr>${cell(`<font color="${c}"><b>${String(t.rank).padStart(2, "0")}</b></font> <font color="#b0b4ba">위</font>`)}${cell("", 'align="right" style="padding:4px 0;"')}</tr>`,
        ) +
        `<p style="font-size:16px;font-weight:bold;margin:20px 0 12px;"><font color="${c}">●</font> ${esc(t.name)}</p>` +
        table(
          `<tr>${cell(`<b style="font-size:32px;white-space:nowrap;">${esc(t.votes.replace(/표$/, ""))}</b> <font color="#b0b4ba">표</font>`, 'width="65%" style="padding:4px 0;"')}${cell(`<font color="${c}" style="font-size:16px;white-space:nowrap;">${esc(t.share)}</font>`, 'align="right" style="padding:4px 0;"')}</tr>`,
        ) +
        `<p style="font-size:12px;color:${i === 0 ? "#ff92ad" : "#b0b4ba"};">${esc(t.gap)}</p>`;
      // Inline tables wrap without media queries. If a board strips display,
      // ordinary block tables still stack safely instead of clipping.
      return `<table width="100%" cellspacing="0" cellpadding="0" border="0" style="display:inline-table;width:100%;max-width:460px;table-layout:fixed;vertical-align:top;margin:6px 0;font:16px/1.6 Arial,sans-serif;"><tbody><tr>${cell(`<font color="#edeef0">${body}</font>`, `bgcolor="${bg}" width="100%" style="padding:16px;text-align:left;border:0.5px solid #363a3f;border-radius:4px;"`)}</tr></tbody></table>`;
    });

    return table(
      `<tr>${cell(`<font color="#ff92ad">VOTE/TRACK / ${esc(edition)}</font><p style="font-size:12px;color:#b0b4ba;">${esc(model.sourceAt)} KST</p>`, 'style="padding:12px;"')}</tr><tr>${cell(cards.join(" "), 'style="padding:0 8px;text-align:center;"')}</tr>`,
      'bgcolor="#111113"',
    );
  }
  // Convert currently displayed chart geometry to run-length-compressed table cells.
  // Cell colors use both HTML attributes and inline CSS; no positioned layers.
  function chart(svg, columns = 160, rows = 96) {
    const vb = svg.viewBox.baseVal,
      W = vb.width || svg.clientWidth,
      H = vb.height || svg.clientHeight;
    const clip = svg.querySelector("clipPath rect"),
      a = (k) => Number(clip?.getAttribute(k) || 0);
    const area = clip
      ? { x: a("x"), y: a("y"), w: a("width"), h: a("height") }
      : { x: 60, y: 12, w: W - 80, h: H - 54 };
    const grid = Array.from({ length: rows }, () => Array(columns).fill(null));
    const map = (x, y) => ({
      x: Math.round(((x - area.x) / area.w) * (columns - 1)),
      y: Math.round(((y - area.y) / area.h) * (rows - 1)),
    });
    const put = (x, y, c) => {
      if (x >= 0 && x < columns && y >= 0 && y < rows) grid[y][x] = c;
    };
    function segment(A, B, c, dashed, phase = 0) {
      let x = A.x,
        y = A.y,
        dx = Math.abs(B.x - x),
        dy = -Math.abs(B.y - y),
        sx = x < B.x ? 1 : -1,
        sy = y < B.y ? 1 : -1,
        err = dx + dy,
        steps = 0;
      // A path can begin outside a zoom window; cap work without joining gaps.
      if (
        Math.abs(x) > 100000 ||
        Math.abs(y) > 100000 ||
        Math.abs(B.x) > 100000 ||
        Math.abs(B.y) > 100000
      )
        return;
      for (let limit = 0; limit < 200000; limit++) {
        if (!dashed || (steps + phase) % 5 < 3) put(x, y, c);
        if (x === B.x && y === B.y) break;
        const e = 2 * err;
        if (e >= dy) {
          err += dy;
          x += sx;
        }
        if (e <= dx) {
          err += dx;
          y += sy;
        }
        steps++;
      }
      return steps;
    }
    for (const node of svg.querySelectorAll("path,line,rect,circle")) {
      if (node.closest("defs")) continue;
      const s = getComputedStyle(node);
      if (
        s.display === "none" ||
        s.visibility === "hidden" ||
        Number(s.opacity) === 0
      )
        continue;
      const tag = node.tagName.toLowerCase(),
        num = (k) => Number(node.getAttribute(k) || 0);
      if (tag === "path" && !transparent(s.stroke)) {
        const commands =
          (node.getAttribute("d") || "").match(/[ML][^ML]*/gi) || [];
        let last = null,
          phase = 0;
        for (const cmd of commands) {
          const nums =
            cmd.slice(1).match(/-?(?:\d*\.)?\d+(?:e[-+]?\d+)?/gi) || [];
          if (cmd[0].toUpperCase() === "M") {
            last = null;
            phase = 0;
          }
          for (let i = 0; i + 1 < nums.length; i += 2) {
            const p = map(+nums[i], +nums[i + 1]);
            if (last)
              phase +=
                segment(
                  last,
                  p,
                  rgb(s.stroke),
                  s.strokeDasharray !== "none",
                  phase,
                ) || 0;
            last = p;
          }
        }
      } else if (tag === "line" && !transparent(s.stroke))
        segment(
          map(num("x1"), num("y1")),
          map(num("x2"), num("y2")),
          rgb(s.stroke),
          s.strokeDasharray !== "none",
        );
      else if (tag === "rect" && !transparent(s.fill)) {
        const p = map(num("x"), num("y")),
          q = map(num("x") + num("width"), num("y") + num("height"));
        for (let y = Math.max(0, p.y); y <= Math.min(rows - 1, q.y); y++)
          for (let x = Math.max(0, p.x); x <= Math.min(columns - 1, q.x); x++)
            put(x, y, rgb(s.fill));
      } else if (tag === "circle" && !transparent(s.fill)) {
        const p = map(num("cx"), num("cy"));
        put(p.x, p.y, rgb(s.fill));
      }
    }
    const text = [...svg.querySelectorAll("text")].map((t) => ({
      x: Number(t.getAttribute("x")),
      y: Number(t.getAttribute("y")),
      text: t.textContent,
    }));
    const ticks = text
      .filter(
        (t) => t.x < area.x && t.y >= area.y - 4 && t.y <= area.y + area.h + 8,
      )
      .sort((a, b) => a.y - b.y);
    const labels = text
      .filter((t) => t.y > area.y + area.h + 8)
      .sort((a, b) => a.x - b.x);
    const annotations = text
      .filter((t) => !ticks.includes(t) && !labels.includes(t))
      .map((t) => t.text);
    const rowHeight = Math.max(2, Math.round(264 / rows));
    const cells = grid
      .map((row) => {
        let html = "";
        for (let x = 0; x < columns; ) {
          let end = x + 1;
          while (end < columns && row[end] === row[x]) end++;
          // Inline CSS survives boards that remove legacy bgcolor attributes. Give
          // every run real content and its own metrics so board td rules cannot win.
          html += `<td${end - x > 1 ? ` colspan="${end - x}"` : ""} style="background:${row[x] || "#18191b"};padding:0;font-size:1px;line-height:1px;">\u200b</td>`;
          x = end;
        }
        return `<tr height="${rowHeight}" style="height:${rowHeight}px;">${html}</tr>`;
      })
      .join("");
    const columnsHTML = `<colgroup>${Array.from({ length: columns }, () => `<col width="${(100 / columns).toFixed(4)}%">`).join("")}</colgroup>`;
    const plot = `<table width="100%" height="${rows * rowHeight}" bgcolor="#18191b" cellspacing="0" cellpadding="0" border="0" style="width:100%;height:${rows * rowHeight}px;table-layout:fixed;border-collapse:collapse;font-size:1px;line-height:1px;">${columnsHTML}<tbody>${cells}</tbody></table>`;
    const axis = `<table width="100%" height="${rows * rowHeight}" cellspacing="0" cellpadding="0" border="0">${ticks.map((t) => `<tr><td align="right" valign="middle" style="padding:0;"><font color="#b0b4ba" style="font-size:12px;">${esc(t.text)}</font></td></tr>`).join("")}</table>`;
    const bottom = table(
      `<tr>${labels.map((t) => cell(`<font color="#b0b4ba" style="font-size:12px;">${esc(t.text)}</font>`, 'align="center" style="padding:0;"')).join("")}</tr>`,
    );
    return `<div><p style="font-size:12px;color:#b0b4ba;">${annotations.map(esc).join(" / ")}</p>${table(`<tr>${cell(axis, 'width="22%" style="padding:0 4px 0 0;"')}${cell(plot + bottom, 'width="78%" style="padding:0;"')}</tr>`)}</div>`;
  }
  function panel(stage, columns = 160, rows = 96) {
    const rootStyle = getComputedStyle(stage);
    function flow(node) {
      if (node.nodeType === Node.TEXT_NODE)
        return esc(node.textContent.replace(/\s+/g, " "));
      if (!(node instanceof Element)) return "";
      const s = getComputedStyle(node);
      if (
        node.hidden ||
        s.display === "none" ||
        s.visibility === "hidden" ||
        ["SCRIPT", "STYLE", "IFRAME", "CANVAS", "IMG"].includes(node.tagName)
      )
        return "";
      if (node instanceof SVGSVGElement) return chart(node, columns, rows);
      if (node instanceof HTMLSelectElement)
        return `<b>${esc(node.selectedOptions[0]?.textContent)}</b>`;
      if (node instanceof HTMLInputElement)
        return node.type === "checkbox"
          ? node.checked
            ? "☑"
            : "☐"
          : esc(node.value);
      if (node.tagName === "BR") return "<br>";
      let style = `color:${s.color};font-size:${s.fontSize};font-weight:${s.fontWeight};line-height:1.5;`;
      if (!transparent(s.backgroundColor))
        style += `background-color:${s.backgroundColor};`;
      if (parseFloat(s.padding)) style += `padding:${s.padding};`;
      if (parseFloat(s.borderTopWidth) > 0 && s.borderTopStyle !== "none")
        style += `border:0.5px solid ${s.borderTopColor};`;
      if (parseFloat(s.borderRadius))
        style += `border-radius:${s.borderRadius};`;
      const children = [...node.childNodes].filter(
        (c) => c.nodeType !== Node.TEXT_NODE || c.textContent.trim(),
      );
      if (!children.length) {
        if (transparent(s.backgroundColor)) return "";
        const parentWidth =
          node.parentElement?.getBoundingClientRect().width || 1;
        const width = Math.min(
          100,
          Math.max(1, (node.getBoundingClientRect().width / parentWidth) * 100),
        );
        return `<table width="${n(width)}%" cellspacing="0" cellpadding="0" border="0"><tr><td bgcolor="${rgb(s.backgroundColor)}" height="4" style="height:4px;font-size:0;line-height:0;"></td></tr></table>`;
      }
      let content;
      const elements = children.filter((c) => c instanceof Element);
      if (
        ((s.display.includes("flex") && s.flexDirection !== "column") ||
          s.display.includes("grid")) &&
        elements.length > 1 &&
        elements.length === children.length
      ) {
        const grouped = [];
        for (const child of elements) {
          const top = child.getBoundingClientRect().top;
          let row = grouped.find((r) => Math.abs(r.top - top) < 4);
          if (!row) {
            row = { top, nodes: [] };
            grouped.push(row);
          }
          row.nodes.push(child);
        }
        // Preserve each item's desktop size as an upper bound, not a minimum.
        // Inline tables wrap in a reader narrower than the source viewport.
        content = grouped
          .map(
            (r) =>
              `<div>${r.nodes
                .map((child) => {
                  const limit = Math.max(
                    140,
                    Math.min(
                      460,
                      Math.ceil(child.getBoundingClientRect().width),
                    ),
                  );
                  return `<table width="100%" cellspacing="0" cellpadding="0" border="0" style="display:inline-table;width:100%;max-width:${limit}px;table-layout:fixed;vertical-align:top;"><tbody><tr>${cell(flow(child), 'style="padding:4px;"')}</tr></tbody></table>`;
                })
                .join(" ")}</div>`,
          )
          .join("");
      } else content = children.map(flow).join("");
      const tag = ["SPAN", "B", "STRONG", "SMALL", "EM", "LABEL", "I"].includes(
        node.tagName,
      )
        ? "span"
        : "div";
      return `<${tag} style="${esc(style)}">${content}</${tag}>`;
    }
    return table(
      `<tr>${cell(`<font color="${rgb(rootStyle.color)}">${[...stage.childNodes].map(flow).join("")}</font>`, 'style="padding:16px;font:16px/1.5 Arial,sans-serif;"')}</tr>`,
      `bgcolor="${rgb(rootStyle.backgroundColor)}"`,
    );
  }
  function hourly(model, edition) {
    const teams = model.rows[0]?.values || [];
    const rows = model.rows
      .map((row) => {
        const valid = row.values.filter((v) => v.delta != null),
          same = new Set(valid.map((v) => v.from + ":" + v.to)).size === 1;
        const max = Math.max(0, ...valid.map((v) => v.delta)),
          winners = same && max > 0 ? valid.filter((v) => v.delta === max) : [];
        const scale = Math.max(1, ...valid.map((v) => Math.abs(v.delta)));
        return `<tr><td style="padding:14px 4px;background:#18191b;vertical-align:top;overflow-wrap:anywhere;"><b>${esc(row.label)}</b><br><small style="color:#ff92ad">${esc(winners.length ? winners.map((v) => v.name).join(" / ") : "구간 다름 / 기록 대기")}</small><br><small style="color:#b0b4ba">${esc(row.status)}</small></td>${row.values.map((v) => `<td style="padding:14px 3px;background:#18191b;vertical-align:top;overflow-wrap:anywhere;"><b${winners.includes(v) ? ' style="color:#ff92ad"' : ""}>${esc(v.label)}</b><div style="height:4px;width:${n((Math.abs(v.delta ?? 0) / scale) * 100)}%;background:${color(v.color)};margin:8px 0;"></div>${v.coverage ? `<small style="color:#b0b4ba;font-size:12px;overflow-wrap:anywhere;">${esc(v.coverage)}</small>` : ""}</td>`).join("")}</tr>`;
      })
      .join("");
    return `<div style="padding:12px;background:#111113;color:#edeef0;font:16px/1.7 Arial,sans-serif;text-align:left;overflow-wrap:anywhere;"><p style="color:#ff92ad;margin:0;">VOTE/TRACK / ${esc(edition)}</p><p style="color:#b0b4ba;font-size:12px;">최신 관측 ${esc(model.sourceAt)} KST</p><h2 style="color:#edeef0;font-size:16px;margin:18px 0;">${esc(model.title)}</h2><p style="color:#b0b4ba;">${esc(model.subtitle)}</p><table style="width:100%;table-layout:fixed;border-collapse:separate;border-spacing:0 8px;color:inherit;font:inherit;"><colgroup><col style="width:22%;">${teams.map(() => '<col style="width:13%;">').join("")}</colgroup><thead><tr><th style="text-align:left;color:#b0b4ba;">시간 / 관측 최다</th>${teams.map((t) => `<th style="text-align:left;font-size:12px;color:${color(t.color)};">${esc(t.name)}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table><p style="color:#b0b4ba;font-size:12px;">데이터 출처 Melon / 비공식 팬 대시보드 / 모든 시각 KST</p></div>`;
  }
  function finalize(html) {
    const template = document.createElement("template");
    template.innerHTML = html;
    function readable(value) {
      const hex = rgb(value),
        channels = hex
          .slice(1)
          .match(/../g)
          .map((v) => parseInt(v, 16));
      const light = channels.map((v) => {
        v /= 255;
        return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      });
      const luminance =
        0.2126 * light[0] + 0.7152 * light[1] + 0.0722 * light[2];
      // Neutral secondary text gets a consistent light tone. Keep bright team
      // colors, while preventing dark theme-inherited text on dark panels.
      if (
        Math.max(...channels) - Math.min(...channels) < 45 &&
        luminance < 0.62
      )
        return "#edeef0";
      return luminance < 0.24 ? "#edeef0" : hex;
    }
    // Keep the established palette, while exporting only simple presentation
    // elements. Table structural tags remain for sizing the compressed charts.
    for (const old of template.content.querySelectorAll("font,small,h2,th")) {
      const tag = old.tagName,
        replacement = document.createElement(
          tag === "TH" ? "td" : tag === "H2" ? "div" : "span",
        );
      for (const attr of old.attributes)
        replacement.setAttribute(attr.name, attr.value);
      if (tag === "SMALL" && !replacement.style.fontSize)
        replacement.style.fontSize = "12px";
      if (tag === "H2" || tag === "TH") replacement.style.fontWeight = "bold";
      replacement.append(...old.childNodes);
      old.replaceWith(replacement);
    }
    function visit(node, inherited = "#edeef0") {
      const specified = node.style.color || node.getAttribute("color");
      const foreground = readable(
        specified && specified !== "inherit" ? specified : inherited,
      );
      if (node.hasAttribute("bgcolor") && !node.style.backgroundColor)
        node.style.backgroundColor = node.getAttribute("bgcolor");
      if (node.style.backgroundColor && ["TABLE", "TD"].includes(node.tagName))
        node.setAttribute("bgcolor", rgb(node.style.backgroundColor));
      const graphCell = node.tagName === "TD" && node.style.fontSize === "1px";
      const text = [...node.childNodes].some(
        (n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim(),
      );
      // Percentage widths include padding and borders. Break long labels even
      // when the HTML was copied from a wide desktop into a narrow board body.
      // Leave the compressed chart runs untouched to preserve their geometry.
      if (!graphCell) {
        if (["TABLE", "TD", "DIV", "P"].includes(node.tagName)) {
          node.style.boxSizing = "border-box";
          if (node.tagName !== "TD" && !node.style.maxWidth)
            node.style.maxWidth = "100%";
        }
        if (node.tagName === "TABLE") node.style.tableLayout = "fixed";
        if (node.tagName === "TD" || node.parentNode === template.content) {
          node.style.overflowWrap = "anywhere";
          node.style.whiteSpace = "normal";
        }
      }
      if (
        !graphCell &&
        (specified ||
          text ||
          ["B", "STRONG", "TH", "TD"].includes(node.tagName))
      )
        node.style.color = foreground;
      for (const child of node.children) visit(child, foreground);
    }
    for (const node of template.content.children) visit(node);
    // DOM serialization adds whitespace to every CSS declaration; remove that
    // overhead so redundant backgrounds still fit the board character limit.
    return template.innerHTML.replace(/style="([^"]*)"/g, (_, css) => {
      const compact = css.replace(
        /rgb\(\s*(\d+),\s*(\d+),\s*(\d+)\s*\)/g,
        (_, r, g, b) =>
          "#" +
          [r, g, b].map((v) => (+v).toString(16).padStart(2, "0")).join(""),
      );
      return `style="${compact.replace(/\s*([:;])\s*/g, "$1").trim()}"`;
    });
  }
  window.MMANativeHTML = { panel, hourly, leaders, finalize };
})();
