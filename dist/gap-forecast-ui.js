/* Current public forecast and joined immutable history. */
(() => {
  "use strict";
  const root = document.getElementById("candle-panel");
  if (!root) return;
  const nf = new Intl.NumberFormat("ko-KR"),
    fmt = (v) => nf.format(Math.round(v)),
    signed = (v) => (v > 0 ? "+" : v < 0 ? "−" : "") + fmt(Math.abs(v)),
    date = (t) =>
      new Intl.DateTimeFormat("ko-KR", {
        timeZone: "Asia/Seoul",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).format(t);
  let lastDue = MMAGapModel.scheduledCutoff(),
    dueTimer;
  let data = window.MMA_DATA || window.MMA_SEED,
    choice = "live",
    server = [],
    active = null,
    ledgerLoading = false,
    lastLedgerFetch = 0,
    retryTimer,
    ledgerFailed = false;
  const section = document.createElement("section");
  section.className = "gap-future";
  section.setAttribute("aria-labelledby", "gap-future-title");
  section.innerHTML = `<div class="gf-heading"><div><div class="section-kicker">NEXT 12 HOURS · RESCENE − 임영웅</div><h3 id="gap-future-title">시간대 패턴으로 보는 12시간 표차 예측</h3></div><label>보기<select id="gf-origin" class="control-select" aria-label="예측 보기"></select></label></div><p class="gf-intro">한국 시간 매일 00시·12시에 이후 12시간을 예측합니다. 양수는 리센느 우세, 음수는 임영웅 우세입니다. 점선은 조건부 예측, 청록 실선은 실제 관측입니다.</p><div id="gf-content"></div><details class="gf-method"><summary>계산 방식·예측 보관과 실제값 비교</summary><p>10월 16일 00시(KST) 이후 최근 최대 7일의 두 팀 관측만 사용합니다. 15분 초과 관측 공백과 득표 정정 구간은 학습에서 제외합니다. 후보는 30분 패턴(최근 보정 포함/제외), 15분 패턴, 전날 동일 시간 변동 반복입니다. 각 정시에 완료된 과거 12시간 예측의 오차로 모델을 다시 비교합니다. 결과는 5분 간격 144개 구간으로 계산합니다.</p><p>최소 24시간의 학습과 충분한 시간대 관측이 필요합니다. 모델 교체는 완료된 12시간 검증 6개 이상·비중복 12시간 구간 6개 이상, 종합 오차 10% 이상 개선, 검증 구간 60% 이상 승리, 최종 표차 오차 악화 5% 이내일 때만 허용합니다. 종합 오차는 경로 MAE 70%와 최종 표차 MAE 30%입니다. 아직 며칠치 자료이므로 반복 패턴이 유지된다는 가정이며, 투표 집중·동원·추세 변화는 미리 알 수 없습니다. 확률이나 확정 결과가 아닙니다.</p><p>정시 예측은 수집 서버에서 발행해 공용 저장소에 기준 시각·모델·선택 근거·입력 해시·예측 경로를 고정 보관합니다. 한 번 발행한 예측은 모델이 바뀌어도 덮어쓰지 않습니다. 과거 예측에서는 완료된 공용 12시간 예측을 시간순으로 이어 봅니다. 새 예측이 시작되는 경계에서는 예측 표차가 다시 맞춰져 선이 달라질 수 있습니다. 보관 기록이 없는 구간은 만들지 않습니다. 오차는 실제 − 예측이며 실제 관측 시각에서 계산합니다. 앞으로의 실제값은 접속·새로고침 후 추가되며 관측이 없으면 —로 남깁니다.</p></details>`;
  root.appendChild(section);
  const $ = (id) => document.getElementById(id);
  function validRecord(m) {
    return (
      m &&
      m.version === MMAGapModel.VERSION &&
      Number.isFinite(m.cutoff) &&
      Number.isFinite(m.origin) &&
      Number.isFinite(m.gap) &&
      Array.isArray(m.path) &&
      [145, 289].includes(m.path.length) &&
      m.path.every(
        (p, i) => Number.isFinite(p.g) && p.t === m.origin + i * 300000,
      )
    );
  }
  function records() {
    return server
      .filter((m) => m.cutoff <= MMAGapModel.scheduledCutoff())
      .sort((a, b) => a.cutoff - b.cutoff);
  }
  async function loadLedger(force = false) {
    if (ledgerLoading || (!force && Date.now() - lastLedgerFetch < 30000))
      return;
    ledgerLoading = true;
    lastLedgerFetch = Date.now();
    let result = null;
    try {
      result = await TrackerHTTP.record(
        "gap-forecasts.json",
        (j) => {
          if (
            j.schemaVersion !== 1 ||
            !Array.isArray(j.records) ||
            !j.records.every(validRecord)
          )
            throw new Error("invalid ledger");
          return j;
        },
        true,
      );
    } catch {}
    ledgerLoading = false;
    ledgerFailed = !result;
    if (result) {
      const map = new Map(server.map((m) => [m.cutoff, m]));
      for (const m of result.records)
        if (!map.has(m.cutoff)) map.set(m.cutoff, m);
      server = [...map.values()].sort((a, b) => a.cutoff - b.cutoff);
    }
    render();
    clearTimeout(retryTimer);
    const cutoff = MMAGapModel.scheduledCutoff(),
      ends = Date.parse(data.operation?.endsAt || TrackerConfig.endsAt);
    if (
      cutoff >= MMAGapModel.START + 86400000 &&
      Date.now() < ends &&
      !records().some((m) => m.cutoff === cutoff)
    )
      retryTimer = setTimeout(() => {
        if (!document.hidden) loadLedger(true);
      }, 60000);
  }
  function selectionInfo(m) {
    const current =
        MMAGapCandidates.find((c) => c.id === (m.modelId || "base"))?.name ||
        "기존 시간대 모델",
      sel = m.selection;
    if (!sel)
      return `<div class="gf-model">사용 모델: <b>${current}</b> · 공용 보관 예측</div>`;
    const reason =
      {
        "insufficient-validation": "검증 자료 부족으로 기존 모델 유지",
        "incumbent-best": "기존 모델이 최저 오차",
        "improvement-not-established": "교체 기준 미충족으로 기존 모델 유지",
        "validated-improvement": "개선 기준 충족으로 모델 교체",
        "no-validation": "검증 자료 대기",
      }[sel.reason] || "기존 모델 유지";
    return `<div class="gf-model">사용 모델: <b>${current}</b> · ${reason}<br>완료 검증 ${sel.validationCount}개 · 비중복 ${sel.nonOverlap}${sel.horizonHours === 12 ? "개 (12시간)" : "일 (발행 당시 검증)"} · ${m.recordKind === "issued" ? "공용 발행 기록" : m.recordKind === "reconstructed" ? "공용 보존·과거 재현 기록" : "과거 재현 계산"}</div><details><summary>모델 자동 선택 근거</summary><div class="table-scroll gf-table"><table><thead><tr><th>후보</th><th>경로 MAE</th><th>최종 MAE</th><th>종합 오차</th></tr></thead><tbody>${(sel.metrics || []).map((r) => `<tr><th>${MMAGapCandidates.find((c) => c.id === r.id)?.name || "후보"}${r.id === m.modelId ? " ✓" : ""}</th><td>${r.n ? fmt(r.mae) : "—"}</td><td>${r.n ? fmt(r.endpointMAE) : "—"}</td><td>${r.n ? fmt(r.score) : "—"}</td></tr>`).join("")}</tbody></table></div></details>`;
  }
  function options() {
    $("gap-future-title").textContent =
      choice === "history" ? "과거 예측과 실제 흐름" : "현재 12시간 표차 예측";
    section.querySelector(".section-kicker").textContent =
      choice === "history"
        ? "FORECAST HISTORY · RESCENE − 임영웅"
        : "NEXT 12 HOURS · RESCENE − 임영웅";
    $("gf-origin").innerHTML = [
      ["live", "현재 12시간 예측"],
      ["history", "과거 예측"],
    ]
      .map(
        ([v, label]) =>
          `<option value="${v}" ${choice === v ? "selected" : ""}>${label}</option>`,
      )
      .join("");
  }
  let historyView = null,
    geometry = null,
    gesture = null;
  const pointers = new Map();
  let pointsInput = null,
    pointsCache = [];
  function actualPoints() {
    if (pointsInput !== data.snapshots) {
      pointsInput = data.snapshots;
      pointsCache = MMAGapModel.points(pointsInput);
    }
    return pointsCache;
  }
  function getActual(target, pts) {
    if (!pts.length || target > pts.at(-1).t) return null;
    let found = null;
    for (const p of pts) {
      if (p.t > target) break;
      found = p;
    }
    return found && target - found.t <= 5 * 60000 ? found : null;
  }
  // Compare at the latest observation, never at an unobserved wall-clock time.
  function currentComparison(model) {
    if (choice !== "live" || model.cutoff !== MMAGapModel.scheduledCutoff())
      return null;
    const a = actualPoints().at(-1);
    if (!a || a.t < model.origin) return null;
    const predicted = MMAGapModel.predicted(model, a.t);
    return Number.isFinite(predicted)
      ? { t: a.t, actual: a.g, predicted, error: a.g - predicted }
      : null;
  }
  function currentSummary(model) {
    const c = currentComparison(model);
    if (!c) return "";
    return `<div class="gf-now" aria-label="현재 관측 시점 실제와 예측 표차"><p>현재 관측 · ${date(c.t)} KST <span>같은 시각의 실제와 예측 비교</span></p><div class="gf-now-values">${[
      ["actual", "현재 실제 표차", c.actual],
      ["predicted", "현재 예측 표차", c.predicted],
      ["error", "차이 · 실제 − 예측", c.error],
    ]
      .map(
        ([key, label, value]) =>
          `<div class="gf-now-${key}" data-value="${value}"><span>${label}</span><strong>${signed(value)}<small>표</small></strong></div>`,
      )
      .join("")}</div></div>`;
  }
  function comparison(model) {
    const c = MMAGapModel.compare(model, data.snapshots);
    return c.samples.length
      ? `<strong>${fmt(c.mae)}표</strong> 평균 절대 오차 · ${c.samples.length}회 실제 관측 비교<br>최근 ${date(c.last.t)} · 예측 ${signed(c.last.predicted)} / 실제 ${signed(c.last.actual)} / 오차 <b>${signed(c.last.error)}표</b>`
      : "아직 예측 이후 실제 관측이 없습니다. 새로고침 후 누적 비교합니다.";
  }
  function table(model, step) {
    const pts = actualPoints();
    return (
      `<div class="table-scroll gf-table"><table><thead><tr><th>시각 (KST)</th><th>예측 표차</th><th>현재 대비 변화</th><th>실제 표차</th><th>실제 − 예측</th></tr></thead><tbody>` +
      model.path
        .filter((p, i) => i > 0 && i % step === 0)
        .map((p) => {
          const a = getActual(p.t, pts),
            pred = a ? MMAGapModel.predicted(model, a.t) : null;
          return `<tr data-time="${p.t}"><th>${date(p.t)}</th><td>${signed(p.g)}</td><td>${signed(p.g - model.gap)}</td><td title="${a ? date(a.t) + " 관측" : ""}">${a ? signed(a.g) : "—"}</td><td>${a ? signed(a.g - pred) : "—"}</td></tr>`;
        })
        .join("") +
      "</tbody></table></div>"
    );
  }
  function chart(model) {
    const historical = !!model.history,
      svg = $("gf-chart"),
      W = Math.max(280, Math.floor(svg.getBoundingClientRect().width || 900)),
      H = 340,
      now = historical ? null : currentComparison(model),
      box = {
        x: W < 500 ? 64 : 78,
        y: 20,
        w: W - (W < 500 ? 64 : 78) - 18,
        h: H - 66,
      };
    const range = historical
        ? historyView
          ? MMAGapHistory.clamp(historyView, model.start, model.end)
          : [model.start, model.end]
        : [model.cutoff, model.cutoff + MMAGapModel.HORIZON],
      xmin = range[0],
      xmax = range[1];
    const all = actualPoints(),
      actual = all.filter(
        (p) =>
          p.t >= (historical ? model.start : xmin) &&
          p.t <= (historical ? model.end : xmax),
      ),
      segments = historical ? model.segments : [model.path],
      visible = [...segments.flat(), ...actual].filter(
        (p) => p.t >= xmin && p.t <= xmax,
      ),
      values = [...visible.map((p) => p.g), 0];
    const lo = Math.min(...values),
      hi = Math.max(...values),
      pad = Math.max(50, (hi - lo) * 0.12),
      rough = (hi - lo + 2 * pad) / 4,
      power = 10 ** Math.floor(Math.log10(rough)),
      step = [1, 2, 2.5, 5, 10].map((n) => n * power).find((n) => n >= rough),
      min = Math.floor((lo - pad) / step) * step,
      max = Math.ceil((hi + pad) / step) * step;
    const x = (t) => box.x + ((t - xmin) / (xmax - xmin)) * box.w,
      y = (g) => box.y + ((max - g) / (max - min)) * box.h,
      path = (pts) =>
        pts
          .map(
            (p, i) =>
              (i ? "L" : "M") + x(p.t).toFixed(1) + "," + y(p.g).toFixed(1),
          )
          .join(" ");
    geometry = { W, H, box, xmin, xmax };
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.dataset.start = xmin;
    svg.dataset.end = xmax;
    svg.dataset.mode = historical ? "history" : "live";
    const tickValues = [];
    for (let v = min; v <= max + step / 2; v += step) tickValues.push(v);
    const ticks = tickValues
      .map(
        (v) =>
          `<g class="gf-y-tick"><line x1="${box.x}" x2="${W - 18}" y1="${y(v)}" y2="${y(v)}" stroke="${v === 0 ? "#a295b0" : "#393346"}" stroke-dasharray="${v === 0 ? "3 3" : "2 4"}"/><text x="${box.x - 9}" y="${y(v) + 4}" text-anchor="end">${fmt(v)}</text></g>`,
      )
      .join("");
    const clock = Date.now(),
      showClock = !historical && clock >= xmin && clock <= xmax,
      time = (t) =>
        new Intl.DateTimeFormat("ko-KR", {
          timeZone: "Asia/Seoul",
          hour: "2-digit",
          minute: "2-digit",
          hourCycle: "h23",
        }).format(t),
      shortDate = (t) =>
        new Intl.DateTimeFormat("ko-KR", {
          timeZone: "Asia/Seoul",
          month: "2-digit",
          day: "2-digit",
        })
          .format(t)
          .replace(/\.\s*/g, "/")
          .replace(/\/$/, "");
    const endpoint = (t, label, anchor) =>
      `<g class="gf-axis-${t === xmin ? "start" : "end"}" data-time="${t}"><text x="${x(t)}" y="${H - 24}" text-anchor="${anchor}" font-size="9">${label} ${shortDate(t)} ${time(t)}</text></g>`;
    const count = W < 500 ? 3 : 5,
      labels = historical
        ? Array.from({ length: count }, (_, i) => {
            const t = xmin + ((xmax - xmin) * i) / (count - 1);
            return `<text x="${x(t)}" y="${H - 24}" text-anchor="${i === 0 ? "start" : i === count - 1 ? "end" : "middle"}">${shortDate(t)}</text><text x="${x(t)}" y="${H - 10}" text-anchor="${i === 0 ? "start" : i === count - 1 ? "end" : "middle"}">${time(t)}</text>`;
          }).join("")
        : endpoint(xmin, "시작", "start") + endpoint(xmax, "끝", "end");
    const clockLine = showClock
      ? `<g class="gf-current-time" data-time="${clock}"><line x1="${x(clock)}" x2="${x(clock)}" y1="${box.y}" y2="${box.y + box.h}" stroke="#c6b7d1" stroke-dasharray="3 4"/><text x="${Math.max(box.x + 32, Math.min(W - 52, x(clock)))}" y="${H - 9}" text-anchor="middle" fill="#aba3b8" font-size="10">현재 ${time(clock)}</text></g>`
      : "";
    const annotations = now
      ? `<g class="gf-now-markers">${[
          { g: now.actual, color: "#4fc8e0" },
          { g: now.predicted, color: "#ff789a" },
        ]
          .map(
            (p) =>
              `<line x1="${box.x}" x2="${x(now.t)}" y1="${y(p.g)}" y2="${y(p.g)}" stroke="${p.color}" stroke-dasharray="3 3"/><circle cx="${x(now.t)}" cy="${y(p.g)}" r="3" fill="${p.color}" stroke="#151321" stroke-width="1"/>`,
          )
          .join("")}</g>`
      : "";
    const boundaries = historical
      ? model.models
          .filter((m) => m.origin > xmin && m.origin < xmax)
          .map(
            (m) =>
              `<line x1="${x(m.origin)}" x2="${x(m.origin)}" y1="${box.y}" y2="${box.y + box.h}" stroke="#877b95" stroke-opacity=".3" stroke-dasharray="2 5"/>`,
          )
          .join("")
      : "";
    svg.innerHTML = `<title>${historical ? "완료된 12시간 예측과 실제의 전체 경로" : "리센느와 임영웅의 현재 12시간 예측과 실제"} (KST)</title><defs><clipPath id="gf-plot"><rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}"/></clipPath></defs><g fill="#aba3b8" font-size="10">${ticks}<line x1="${box.x}" x2="${W - 18}" y1="${box.y + box.h}" y2="${box.y + box.h}" stroke="#877b95"/>${labels}</g><g clip-path="url(#gf-plot)">${boundaries}${segments.map((p) => `<path class="gf-predicted-path" d="${path(p)}" stroke="#ff789a" stroke-width="1.6" stroke-dasharray="5 4" fill="none"/>`).join("")}<path class="gf-actual-path" d="${path(actual)}" stroke="#4fc8e0" stroke-width="1.6" fill="none"/>${annotations}</g>${clockLine}`;
    if (historical)
      $("gf-history-range").textContent =
        `${date(xmin)} ~ ${date(xmax)} KST · 전체 ${model.models.length}개 예측`;
    svg.onpointermove = (e) => {
      if (historical && moveHistory(e)) return;
      const rect = e.currentTarget.getBoundingClientRect(),
        t = Math.max(
          xmin,
          Math.min(
            xmax,
            xmin +
              ((((e.clientX - rect.left) * W) / rect.width - box.x) / box.w) *
                (xmax - xmin),
          ),
        ),
        m = historical
          ? model.models.find((m) => t > m.origin && t <= m.path.at(-1).t) ||
            model.models.find((m) => t === m.origin)
          : model,
        p = m ? MMAGapModel.predicted(m, t) : null,
        a = getActual(t, all);
      $("gf-hover").textContent =
        `${date(t)} · 예측 ${p == null ? "기록 없음" : signed(p) + "표"}${a ? " · 실제 " + signed(a.g) + "표" : ""}${a && m && a.t >= m.origin ? " · 차이 " + signed(a.g - MMAGapModel.predicted(m, a.t)) + "표" : ""}`;
    };
  }
  function setHistoryView(view) {
    if (!active?.history) return;
    historyView = MMAGapHistory.clamp(view, active.start, active.end);
    chart(active);
  }
  function chartFraction(clientX) {
    const rect = $("gf-chart").getBoundingClientRect();
    return Math.max(
      0,
      Math.min(
        1,
        (((clientX - rect.left) * geometry.W) / rect.width - geometry.box.x) /
          geometry.box.w,
      ),
    );
  }
  function startGesture() {
    if (!pointers.size) {
      gesture = null;
      return;
    }
    const points = [...pointers.values()],
      center =
        points.length > 1 ? (points[0].x + points[1].x) / 2 : points[0].x,
      span = geometry.xmax - geometry.xmin;
    gesture = {
      center,
      span,
      start: geometry.xmin,
      anchor: geometry.xmin + chartFraction(center) * span,
      distance:
        points.length > 1
          ? Math.max(
              1,
              Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y),
            )
          : null,
      width:
        (geometry.box.w * $("gf-chart").getBoundingClientRect().width) /
        geometry.W,
    };
  }
  function moveHistory(e) {
    if (!pointers.has(e.pointerId) || !gesture) return false;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const p = [...pointers.values()],
      g = gesture;
    if (p.length > 1 && g.distance) {
      const center = (p[0].x + p[1].x) / 2,
        span =
          (g.span * g.distance) /
          Math.max(1, Math.hypot(p[1].x - p[0].x, p[1].y - p[0].y)),
        left = g.anchor - chartFraction(center) * Math.max(3600000, span);
      setHistoryView([left, left + span]);
    } else {
      const left = g.start - ((p[0].x - g.center) / g.width) * g.span;
      setHistoryView([left, left + g.span]);
    }
    return true;
  }
  function bindChart() {
    if (choice !== "history") return;
    const svg = $("gf-chart");
    svg.classList.add("gf-interactive");
    svg.onpointerdown = (e) => {
      if (e.button > 0) return;
      e.preventDefault();
      svg.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      startGesture();
    };
    const end = (e) => {
      pointers.delete(e.pointerId);
      startGesture();
    };
    svg.onpointerup = end;
    svg.onpointercancel = end;
    svg.onlostpointercapture = end;
    svg.addEventListener(
      "wheel",
      (e) => {
        if (!e.ctrlKey) return;
        e.preventDefault();
        const span = geometry.xmax - geometry.xmin,
          ratio = chartFraction(e.clientX),
          at = geometry.xmin + ratio * span,
          next = Math.min(
            active.end - active.start,
            Math.max(3600000, span * (e.deltaY < 0 ? 0.5 : 2)),
          ),
          left = at - ratio * next;
        setHistoryView([left, left + next]);
      },
      { passive: false },
    );
    for (const name of ["gesturestart", "gesturechange", "gestureend"])
      svg.addEventListener(name, (e) => e.preventDefault(), { passive: false });
    $("gf-zoom-in").onclick = () => {
      const span = (geometry.xmax - geometry.xmin) / 2,
        center = (geometry.xmin + geometry.xmax) / 2;
      setHistoryView([center - span / 2, center + span / 2]);
    };
    $("gf-zoom-out").onclick = () => {
      const span = (geometry.xmax - geometry.xmin) * 2,
        center = (geometry.xmin + geometry.xmax) / 2;
      setHistoryView([center - span / 2, center + span / 2]);
    };
    $("gf-reset").onclick = () => {
      historyView = null;
      chart(active);
    };
  }
  function renderHistory() {
    active = MMAGapHistory.build(records());
    const h = active;
    if (!h.models.length) {
      $("gf-content").innerHTML =
        '<p class="gf-empty">완료된 공용 예측을 기다리고 있습니다. 12시간 예측이 끝나면 여기에 자동으로 추가됩니다.</p>';
      return;
    }
    const c = MMAGapHistory.compare(h, data.snapshots);
    $("gf-content").innerHTML =
      `<p class="gf-stamp">누적 예측 ${h.models.length}개 · ${date(h.start)} ~ ${date(h.end)} KST · 완료된 12시간 예측과 실제를 이어 표시합니다.</p><p class="gf-intro">새 12시간 예측이 끝나면 이 그래프에 추가됩니다. 각 경계에서 새 예측의 기준 표차가 반영됩니다. 이전 화면에서 볼 수 있던 과거 예측도 함께 표시합니다.</p><div class="gf-history-controls"><button id="gf-zoom-in" class="subtle" type="button" aria-label="과거 예측 확대">＋ 확대</button><button id="gf-zoom-out" class="subtle" type="button" aria-label="과거 예측 축소">− 축소</button><button id="gf-reset" class="subtle" type="button">전체 보기</button><span>드래그 이동 · Ctrl+휠 확대/축소 · 모바일 두 손가락 확대</span></div><p class="gf-legend"><span>━━ 실제 표차</span><span>┄┄ 당시 12시간 예측</span></p><svg id="gf-chart" role="img" aria-label="과거 12시간 예측과 실제의 전체 경로"></svg><p id="gf-history-range" class="gf-stamp"></p><p id="gf-hover" class="gf-hover">차트에서 시각별 예측과 실제 표차를 비교할 수 있습니다.</p><div class="gf-accuracy"><span>전체 과거 예측과 실제 비교</span><p>${c.mae == null ? "비교할 실제 관측 대기" : `<strong>${fmt(c.mae)}표</strong> 평균 절대 오차 · ${c.samples.length}회 실제 관측 비교`}</p></div><details id="gf-history-detail"><summary>12시간 구간별 예측과 실제 비교</summary><div class="table-scroll gf-table"><table><thead><tr><th>예측 시작 (KST)</th><th>예측 끝 (KST)</th><th>기록</th><th>종료 예측 표차</th><th>종료 실제 표차</th><th>실제 − 예측</th><th>평균 절대 오차</th></tr></thead><tbody>${c.rows
        .map((r) => {
          const end = r.model.path.at(-1),
            a = getActual(end.t, actualPoints()),
            pred = a ? MMAGapModel.predicted(r.model, a.t) : null;
          return `<tr data-cutoff="${r.model.cutoff}"><th>${date(r.model.origin)}</th><td>${date(end.t)}</td><td>${r.model.restoredFrom ? "이전 예측 복원" : "보관 예측"}</td><td>${signed(end.g)}</td><td title="${a ? date(a.t) + " 관측" : ""}">${a ? signed(a.g) : "—"}</td><td>${a ? signed(a.g - pred) : "—"}</td><td>${r.mae == null ? "—" : fmt(r.mae)}</td></tr>`;
        })
        .join("")}</tbody></table></div></details>`;
    chart(h);
    bindChart();
  }
  function render() {
    if (!data?.snapshots?.length) return;
    options();
    pointers.clear();
    gesture = null;
    if (choice === "history") {
      renderHistory();
      return;
    }
    const cutoff = MMAGapModel.scheduledCutoff(),
      fixed = records().find((m) => m.cutoff === cutoff);
    active = fixed ? MMAGapModel.window12(fixed) : null;
    if (!active) {
      $("gf-content").innerHTML =
        `<p class="gf-empty">${date(cutoff)} KST 기준 예측 발행을 기다리고 있습니다. 완료된 예측은 ‘과거 예측’에서 볼 수 있습니다.</p>`;
      return;
    }
    const m = active;
    $("gf-content").innerHTML =
      `<p class="gf-stamp">현재 12시간 예측 · ${date(m.cutoff)} ~ ${date(m.cutoff + MMAGapModel.HORIZON)} KST · 학습 ${date(m.trainingFrom)} ~ ${date(m.trainingTo)} · ${m.observations}회${ledgerFailed ? " · 공용 기록 연결 지연" : ""}</p>${selectionInfo(m)}<div class="gf-cards">` +
      [0, 4, 8, 12]
        .map((h) => {
          const p = m.path[h * 12];
          return `<div><span>${h ? h + "시간 후" : "기준 시점"} 예측 표차</span><strong>${signed(p.g)}표</strong><small>${h ? "기준 대비 " + signed(p.g - m.gap) + "표" : m.gap >= 0 ? "리센느 우세" : "임영웅 우세"}</small></div>`;
        })
        .join("") +
      `</div><p class="gf-legend"><span>━━ 실제 표차</span><span>┄┄ 5분 간격 조건부 예측</span></p>${currentSummary(m)}<svg id="gf-chart" role="img" aria-label="리센느와 임영웅 현재 12시간 표차 예측 및 실제 비교"></svg><p id="gf-hover" class="gf-hover">차트에서 시각별 예측값을 확인할 수 있습니다.</p><div class="gf-accuracy"><span>현재 예측의 12시간 실제값 비교</span><p>${comparison(m)}</p></div><details><summary>시간별 예측 수치와 실제 오차 (12시간)</summary>${table(m, 12)}</details><details id="gf-detail"><summary>5분 단위 상세 수치 (144구간)</summary><div id="gf-fine"></div></details>`;
    $("gf-detail").addEventListener("toggle", (e) => {
      if (e.target.open && !$("gf-fine").children.length)
        $("gf-fine").innerHTML = table(m, 1);
    });
    chart(m);
  }
  $("gf-origin").addEventListener("change", (e) => {
    choice = e.target.value;
    render();
  });
  window.addEventListener("mma:data", (e) => {
    data = e.detail;
    render();
    loadLedger();
  });
  let timer;
  window.addEventListener("resize", () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (active && $("gf-chart")) chart(active);
    }, 150);
  });
  function checkDue() {
    const next = MMAGapModel.scheduledCutoff();
    if (next !== lastDue) {
      lastDue = next;
      render();
      window.dispatchEvent(new Event("mma:forecast-due"));
      loadLedger(true);
    }
    clearTimeout(dueTimer);
    dueTimer = setTimeout(
      checkDue,
      Math.max(1000, next + 12 * 3600000 - Date.now() + 500),
    );
  }
  setInterval(() => {
    if (!document.hidden && active && $("gf-chart")) chart(active);
  }, 60000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      checkDue();
      loadLedger();
    }
  });
  checkDue();
  render();
  loadLedger();
})();
