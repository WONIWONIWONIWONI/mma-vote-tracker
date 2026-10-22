/* Native, static forum cards. Only allowlisted HTML with inline styles. */
(() => {
  const panels = [
    ["leaders", "#leaders", "현재 상위 6팀"],
    ["overview", ".overview-bar", "전체 투표 요약"],
    ["trend", ".chart-panel", "득표 추이"],
    ["candles", "#candle-panel", "표차 흐름 분석"],
    ["forecast", ".gap-future", "표차 예측"],
    ["daily", ".daily-panel", "하루 누적 득표 증가량"],
    ["hourly", ".hourly-panel", "시간대별 득표 증가량"],
    ["history", "#history-details", "최근 집계 기록"],
  ];
  const esc = (s) =>
    String(s ?? "").replace(
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
  const $ = (s) => document.querySelector(s),
    text = (s) => $(s)?.textContent.trim() || "—";
  const num = (n) =>
    n == null
      ? "—"
      : new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 2 }).format(n);
  const kst = (t) =>
    new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Asia/Seoul",
      dateStyle: "short",
      timeStyle: "short",
    }).format(new Date(t));
  const p = (s) =>
    `<p style="margin:12px 0;color:#a4adbf;font-size:12px;line-height:1.8;">${esc(s)}</p>`;
  const box = (s) =>
    `<div style="margin-top:14px;padding:20px;background:#1a1e2b;border:1px solid #2c3346;border-radius:14px;color:#f5f6fa;">${s}</div>`;
  function table(headers, rows) {
    const cell = (s, tag) =>
      `<${tag} style="border:0;border-bottom:1px solid #30374a;padding:12px 10px;text-align:left;font-size:${tag === "th" ? 11 : 13}px;font-weight:${tag === "th" ? 500 : 600};word-break:break-word;color:${tag === "th" ? "#a4adbf" : "#f5f6fa"};background:${tag === "th" ? "#22283a" : "#1a1e2b"};">${esc(s)}</${tag}>`;
    return `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;table-layout:fixed;"><tbody><tr>${headers.map((s) => cell(s, "th")).join("")}</tr>${rows.map((r) => `<tr>${r.map((s) => cell(s, "td")).join("")}</tr>`).join("")}</tbody></table>`;
  }
  function leaderCard(team, i, last) {
    const other = last.top4[i === 0 ? 1 : i - 1];
    const color =
      TrackerConfig.teams.find((x) => String(x.id) === String(team.id))
        ?.color || "#f2aac2";
    const percent = ((100 * team.votes) / last.totalVotes).toFixed(2);
    const gap = `${other.rank}위 ${other.name}와 ${num(Math.abs(team.votes - other.votes))}표 차이`;
    return `<div style="margin-top:12px;padding:20px;background:${i < 2 ? "#212536" : "#1a1e2b"};border:1px solid #30374a;border-radius:14px;">
      <p style="margin:0 0 14px;color:#f5f6fa;font-size:17px;font-weight:700;"><span style="color:${esc(color)};font-size:12px;margin-right:12px;">${String(team.rank).padStart(2, "0")} RANK</span> ${esc(team.name)}</p>
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;"><tbody><tr><td style="border:0;padding:0;color:#a4adbf;font-size:11px;">누적 득표수</td><td style="border:0;padding:0;text-align:right;color:#a4adbf;font-size:11px;">전체 투표 중 득표율</td></tr><tr><td style="border:0;padding:6px 0;color:#ffffff;font-size:28px;font-weight:800;letter-spacing:-1px;">${esc(num(team.votes))}<span style="font-size:12px;color:#a4adbf;font-weight:400;"> 표</span></td><td style="border:0;padding:6px 0;text-align:right;color:${esc(color)};font-size:22px;font-weight:700;">${percent}<span style="font-size:12px;">%</span></td></tr></tbody></table>
      <div style="height:3px;margin:12px 0;background:#343c50;border-radius:3px;"><div style="width:${percent}%;height:3px;background:${esc(color)};border-radius:3px;"></div></div>
      <p style="margin:0;color:#b8c0d1;font-size:12px;line-height:1.7;">${esc(gap)}</p></div>`;
  }
  function bar(name, value, width, color) {
    return box(
      `<p style="margin:0 0 12px;font-size:13px;color:${esc(color)};font-weight:700;">${esc(name)}</p><p style="margin:0 0 10px;font-size:28px;font-weight:800;letter-spacing:-0.6px;color:#ffffff;">${esc(value)}</p><div style="height:7px;background:#343c50;border-radius:6px;"><div style="width:${Math.min(100, Math.max(0, width))}%;height:7px;background:${esc(color)};border-radius:6px;"></div></div>`,
    );
  }
  // Rebuild trusted UI text with an explicit tag/attribute allowlist. Never copy handlers,
  // ids, classes, form controls, external CSS, SVG or untrusted raw markup.
  function native(node) {
    if (!node) return "";
    if (node.nodeType === Node.TEXT_NODE) return esc(node.textContent);
    if (node.nodeType !== Node.ELEMENT_NODE || node.hidden) return "";
    const tag = node.tagName.toLowerCase();
    if (
      [
        "script",
        "style",
        "svg",
        "canvas",
        "button",
        "input",
        "select",
        "img",
      ].includes(tag)
    )
      return "";
    const allowed = [
      "table",
      "thead",
      "tbody",
      "tr",
      "th",
      "td",
      "p",
      "b",
      "strong",
      "small",
      "span",
      "br",
    ];
    const out = allowed.includes(tag) ? tag : "div";
    if (tag === "br") return "<br />";
    const css = getComputedStyle(node);
    let style = `color:${css.color};font-weight:${css.fontWeight};font-size:${Math.min(22, parseFloat(css.fontSize) || 13)}px;line-height:1.7;`;
    if (out === "table")
      style += "width:100%;border-collapse:collapse;table-layout:fixed;";
    else if (["td", "th"].includes(out))
      style +=
        "border:0;border-bottom:1px solid #30374a;padding:12px 8px;word-break:break-word;";
    else if (out === "div") style += "margin:6px 0;";
    else if (out === "small") style += "display:block;";
    if (
      node.matches(
        ".pc-team,.pc-metric,.gf-cards > div,.gf-now-values > div,.gf-model,.gf-accuracy",
      )
    )
      style +=
        "padding:18px;margin:12px 0;background:#1a1e2b;border:1px solid #30374a;border-radius:12px;";
    if (node.matches("strong")) style += "color:#f5f6fa;font-size:20px;";
    return `<${out} style="${esc(style)}">${[...node.childNodes].map(native).join("")}</${out}>`;
  }
  function content(key) {
    const last = window.MMA_DATA.snapshots.at(-1);
    if (key === "leaders")
      return last.top4.map((t, i) => leaderCard(t, i, last)).join("");
    if (key === "overview")
      return table(
        ["항목", "값"],
        [
          ["전체 투표", num(last.totalVotes) + "표"],
          ["상위 6팀 점유율", text("#top-share")],
          ["그 외", text("#other-share")],
          ["누적 기록", text("#sample-count") + "회"],
        ],
      );
    if (key === "daily")
      return (
        p(text("#daily-title")) +
        native($("#daily-summary")) +
        [...document.querySelectorAll(".daily-team")]
          .map((el) =>
            bar(
              el.querySelector(".daily-name").textContent,
              el.querySelector("strong").textContent,
              parseFloat(el.querySelector(".daily-bar i").style.width) || 0,
              getComputedStyle(el).getPropertyValue("--color").trim(),
            ),
          )
          .join("") +
        p(text("#daily-note"))
      );
    if (key === "hourly") {
      const m = MMAShareModels.hourly();
      return (
        p(m.subtitle) +
        m.rows
          .map((r) =>
            box(
              p(r.label + " · " + r.status) +
                table(
                  ["팀", "증가량", "관측 구간"],
                  r.values.map((v) => [
                    v.name,
                    v.label,
                    v.coverage || "1시간 전체",
                  ]),
                ),
            ),
          )
          .join("") +
        p(text("#hourly-note"))
      );
    }
    if (key === "trend") {
      const m = MMAShareModels.trend();
      return (
        p(m.subtitle + " · " + m.chartTitle) +
        m.series
          .map((s) => {
            const points = s.points.filter(
                (p) => p.time >= m.xmin && p.time <= m.xmax && p.value != null,
              ),
              a = points[0],
              b = points.at(-1);
            return box(
              p(s.name) +
                table(
                  ["구간 내 처음 관측", "구간 내 마지막 관측", "변화량"],
                  [
                    [
                      a ? kst(a.time) + " · " + num(a.value) : "—",
                      b ? kst(b.time) + " · " + num(b.value) : "—",
                      a && b ? num(b.value - a.value) : "—",
                    ],
                  ],
                ),
            );
          })
          .join("") +
        p(
          "선 그래프를 선택 구간 내 관측 요약으로 표시합니다. 점유율 변화 단위는 %p입니다. 중간 관측 공백은 보간하지 않습니다.",
        ) +
        p(m.note)
      );
    }
    if (key === "candles") {
      const candles = window.MMACandleShare(),
        a = candles[0],
        b = candles.at(-1);
      return (
        p(
          "상대 팀: " +
            $("#gap-pair").selectedOptions[0].textContent +
            " · 분석 " +
            text("#pc-tf .selected") +
            " · 봉 간격 " +
            text("#cd-tf .selected"),
        ) +
        native($("#pc-body")) +
        p(text("#cd-range")) +
        (a
          ? table(
              ["시작 표차", "최고 표차", "최저 표차", "마지막 표차"],
              [
                [
                  num(a.o),
                  num(Math.max(...candles.map((c) => c.h))),
                  num(Math.min(...candles.map((c) => c.l))),
                  num(b.c),
                ],
              ],
            )
          : p("관측 대기")) +
        p(
          "리센느 − 상대 팀, 단위: 표. 화면에 보이는 캔들 구간의 요약입니다. 개별 캔들과 관측 공백은 원본 차트에서 확인하세요.",
        ) +
        p(text(".pc-note"))
      );
    }
    if (key === "forecast")
      return (
        p(text("#gap-future-title")) +
        native($("#gf-content")) +
        p("예측은 조건부 추정입니다. 그래프는 원본 링크에서 확인하세요.")
      );
    return (
      p("최신 10회 관측 · 전체 기록은 원본에서 확인하세요.") +
      table(
        ["시각 (KST)", "팀별 득표"],
        window.MMA_DATA.snapshots
          .slice(-10)
          .reverse()
          .map((s) => [
            kst(s.sourceAt),
            s.top4.map((t) => t.name + " " + num(t.votes) + "표").join(" / "),
          ]),
      )
    );
  }
  const dialog = document.createElement("dialog");
  dialog.className = "share-dialog";
  dialog.innerHTML =
    '<h2>디시용 HTML 복사</h2><p>복사 시점의 수치와 선택 조건을 담은 HTML 카드입니다. 디시 PC 글쓰기에서 HTML 모드를 켜고 붙여넣으세요. 게시 후 자동 갱신되지는 않습니다. 선·캔들 그래프는 수치 요약으로 표시합니다.</p><div class="share-preview" aria-label="게시용 카드 미리보기"></div><textarea aria-label="게시용 HTML 소스" readonly></textarea><p class="share-status" role="status"></p><div><button class="quiet-button" data-copy-share>HTML 복사</button> <button class="quiet-button" data-close-share>닫기</button></div>';
  document.body.append(dialog);
  dialog.querySelector("[data-close-share]").onclick = () => dialog.close();
  dialog.querySelector("[data-copy-share]").onclick = async () => {
    const input = dialog.querySelector("textarea");
    try {
      await navigator.clipboard.writeText(input.value);
      dialog.querySelector(".share-status").textContent =
        "복사했습니다. 디시 PC 글쓰기 HTML 모드에 붙여넣으세요.";
    } catch {
      input.focus();
      input.select();
      dialog.querySelector(".share-status").textContent =
        "소스를 선택했습니다. Ctrl+C 또는 길게 눌러 복사하세요.";
    }
  };
  for (const [key, selector, title] of panels) {
    const panel = $(selector);
    if (!panel) continue;
    if (!panel.id) panel.id = "share-" + key;
    const controls = document.createElement("div");
    controls.className = "panel-share-controls";
    const button = document.createElement("button");
    button.className = "quiet-button";
    button.type = "button";
    button.textContent = "디시용 HTML";
    button.dataset.sharePanel = key;
    button.setAttribute("aria-label", title + " 디시용 HTML");
    controls.append(button);
    if (["leaders", "overview"].includes(key)) panel.after(controls);
    else panel.append(controls);
    button.onclick = () => {
      const link = new URL("#" + panel.id, location.href).href;
      const html = `<div style="max-width:680px;margin:0 auto;padding:24px;background:#10121b;border:1px solid #30374a;border-radius:20px;color:#f5f6fa;font-family:'Malgun Gothic',sans-serif;line-height:1.6;">
        <div style="padding:8px 0 20px;border-bottom:1px solid #30374a;margin-bottom:20px;"><p style="margin:0 0 14px;color:#f2aac2;font-size:11px;letter-spacing:2px;font-weight:700;">VOTE / TRACK · ${esc(TrackerConfig.edition)}</p><p style="margin:0;color:#ffffff;font-size:28px;letter-spacing:-1px;font-weight:800;">${esc(title)}</p>${p("관측 시각 " + kst(window.MMA_DATA.snapshots.at(-1).sourceAt) + " KST")}</div>
        ${content(key)}<div style="margin-top:24px;padding-top:16px;border-top:1px solid #30374a;">${p("Melon 공개 집계 · 비공식 팬 대시보드 · 공유 당시 기록")}<p style="margin:14px 0 4px;"><a href="${esc(link)}" style="color:#f2aac2;font-size:13px;font-weight:700;text-decoration:none;">최신 트래커와 그래프 열기 ↗</a></p></div></div>`;
      dialog.querySelector("textarea").value = html;
      dialog.querySelector(".share-preview").innerHTML = html;
      dialog.querySelector(".share-status").textContent =
        "미리보기를 확인한 뒤 HTML 복사를 누르세요.";
      dialog.showModal();
    };
  }
})();
