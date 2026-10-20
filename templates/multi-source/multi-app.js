/* Multi-source shell. The existing detailed MMA shell remains an independent view. */
(() => {
  "use strict";
  const C = TrackerMulti.validateConfig(TrackerConfig),
    M = TrackerMulti,
    $ = (id) => document.getElementById(id);
  const escape = (value) =>
    String(value).replace(
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
  const format = (value) =>
    value == null ? "—" : Math.round(value).toLocaleString("ko-KR");
  const date = (value) =>
    new Intl.DateTimeFormat("ko-KR", {
      timeZone: "Asia/Seoul",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(new Date(value));
  let records = [],
    view = "total",
    history = [],
    windowRange = null,
    chosenDate = null,
    loading = false,
    archiveTask = null;
  const hidden = new Set(),
    failures = {},
    sourceColors = ["#65d9ca", "#ba9bff", "#ffc07c", "#90bbff"];
  const color = (source, i) =>
    source.color || sourceColors[i % sourceColors.length];
  let current,
    geometry,
    gesture = null;
  const pointers = new Map();
  $("title").textContent = C.title;
  document.title = C.title;
  $("official").innerHTML = C.sources
    .map(
      (source) =>
        `<a href="${escape(source.url)}" target="_blank" rel="noopener noreferrer">${escape(source.label)} ↗</a>`,
    )
    .join("");
  $("tabs").innerHTML = [{ id: "total", label: "합계" }, ...C.sources]
    .map(
      (source) =>
        `<button data-view="${escape(source.id)}" aria-pressed="${source.id === view}">${escape(source.label)}</button>`,
    )
    .join("");
  function latest() {
    return Object.fromEntries(records.map((row) => [row.sourceId, row]));
  }
  function update(incoming) {
    records = M.mergeRecords(records, incoming);
    history = M.timeline(C, records);
    render();
  }
  function render() {
    current = M.aggregate(C, latest());
    $("sources").innerHTML = current.sources
      .map((entry, i) => {
        const source = C.sources[i],
          status = {
            ok: "조회 완료",
            missing: "관측 대기",
            invalid: "검증 실패",
            incomplete: "팀 기록 부족",
            stale: "오래된 관측",
          }[entry.state];
        return `<article class="source" style="--source:${color(source, i)}"><h2>${escape(source.label)}</h2><strong>${format(entry.snapshot?.totalVotes)}<small> 표</small></strong><small>${status}${failures[source.id] ? " · 최신 조회 실패" : ""}<br>${entry.snapshot ? date(entry.snapshot.observedAt) + " 관측" : "공개 집계 연결 대기"}</small></article>`;
      })
      .join("");
    $("status").textContent = loading
      ? "투표처별 최신 수치를 조회하고 있습니다."
      : Object.values(failures).some(Boolean)
        ? "일부 최신 조회에 실패했습니다. 마지막 정상 관측 시각을 확인해 주세요."
        : "접속·새로고침 때 최신 조회 · 자동 조회 없음";
    $("coverage").textContent = current.complete
      ? `합산 관측 ${date(current.from)} ~ ${date(current.to)} · 각 투표처의 공개 표수 단순 합계`
      : current.reason === "time-skew"
        ? "투표처별 관측 시각 차이가 커 합산을 보류합니다. 새로고침해 주세요."
        : "모든 투표처의 유효한 관측이 모이면 합계를 표시합니다. 누락된 값은 0으로 채우지 않습니다.";
    const snapshot = M.legacySnapshot(current, view),
      selected = C.sources.find((source) => source.id === view);
    $("ranking-title").textContent = selected
      ? selected.label + " 순위"
      : "합산 순위";
    $("total").textContent = "전체 후보 " + format(snapshot?.totalVotes) + "표";
    const rows = snapshot?.top4 || current.rows;
    $("ranking").innerHTML =
      "<thead><tr><th>아티스트</th>" +
      C.sources.map((source) => `<th>${escape(source.label)}</th>`).join("") +
      `<th>${selected ? "선택 투표처" : "합계"} / 비율</th></tr></thead><tbody>` +
      rows
        .map((row, i) => {
          const full = current.rows.find((item) => item.id === row.id),
            votes = snapshot ? row.votes : null,
            total = snapshot?.totalVotes;
          const gap =
            snapshot && rows.length > 1
              ? Math.abs(votes - rows[i === 0 ? 1 : i - 1].votes)
              : null;
          const widths = C.sources.map(
              (source) => full.contributions[source.id] ?? 0,
            ),
            sum = widths.reduce((a, b) => a + b, 0);
          return (
            `<tr><td><span class="name"><i class="team-dot" style="--team:${escape(row.color || "#65d9ca")}"></i>${snapshot ? i + 1 + ". " : ""}${escape(row.name)}</span><small>${gap == null ? "기록 대기" : (i === 0 ? "2위" : i + "위") + "와 " + format(gap) + "표 차이"}</small></td>` +
            C.sources
              .map(
                (source) => `<td>${format(full.contributions[source.id])}</td>`,
              )
              .join("") +
            `<td><strong>${format(votes)}</strong><small>${votes == null ? "—" : (total ? (votes / total) * 100 : 0).toFixed(2) + "%"}</small>${view === "total" && current.complete ? `<span class="contribution">${widths.map((n, j) => `<i style="width:${sum ? (n / sum) * 100 : 0}%;background:${color(C.sources[j], j)}"></i>`).join("")}</span>` : ""}</td></tr>`
          );
        })
        .join("") +
      "</tbody>";
    $("legend").innerHTML = C.candidates
      .map(
        (team) =>
          `<button data-team="${escape(team.id)}" aria-pressed="${!hidden.has(team.id)}"><i class="team-dot" style="--team:${escape(team.color || "#65d9ca")}"></i>${escape(team.name)}</button>`,
      )
      .join("");
    chart();
    daily();
  }
  function samples() {
    return history.map((item) => ({
      time: item.time,
      snapshot: M.legacySnapshot(item, view),
    }));
  }
  function daily() {
    // Reused daily arithmetic consumes only complete observations; no synthetic votes.
    const snapshots = [
      ...new Map(
        samples()
          .filter((item) => item.snapshot)
          .map((item) => [item.snapshot.sourceAt, item.snapshot]),
      ).values(),
    ];
    const now = Math.min(
      Date.now(),
      C.endsAt ? Date.parse(C.endsAt) - 1 : Infinity,
    );
    const days = MMADaily.build(snapshots, C.candidates, now),
      selected = days.find((day) => day.date === chosenDate) || days[0];
    $("day").innerHTML = days
      .map(
        (day) =>
          `<option value="${day.date}"${day === selected ? " selected" : ""}>${day.date}</option>`,
      )
      .join("");
    if (!selected) {
      $("daily").textContent = "비교할 관측을 기다리고 있습니다.";
      $("daily-note").textContent = "";
      return;
    }
    const rows = selected.values
        .slice()
        .sort((a, b) => (b.delta ?? -Infinity) - (a.delta ?? -Infinity)),
      max = Math.max(0, ...rows.map((row) => row.delta ?? 0));
    $("daily").innerHTML = rows
      .map(
        (row) =>
          `<article class="${max > 0 && row.delta === max ? "best" : ""}">${escape(row.name)}${max > 0 && row.delta === max ? " · 최다 증가" : ""}<strong>${row.delta > 0 ? "+" : ""}${format(row.delta)}표</strong></article>`,
      )
      .join("");
    $("daily-note").textContent =
      (selected.ongoing ? "집계 중" : "마감") +
      (selected.partial ? " · 일부 관측 구간" : "") +
      " · KST 00시 기준, 실제 경계 관측이 있을 때만 하루 전체로 표시합니다.";
  }
  function bounds() {
    const times = history.map((row) => row.time);
    const end = times.at(-1) || Date.now(),
      start = times[0] ?? end;
    return [Math.min(start, end - 60000), end];
  }
  function setRange(start, end) {
    const [min, max] = bounds(),
      span = Math.max(60000, Math.min(max - min, end - start)),
      left = Math.max(min, Math.min(max - span, start));
    windowRange = [left, left + span];
    chart();
  }
  function chart() {
    const svg = $("trend"),
      W = Math.max(280, svg.getBoundingClientRect().width),
      H = 320,
      all = bounds(),
      range = windowRange || all,
      [min, max] = range;
    const rows = samples(),
      teams = C.candidates.filter((team) => !hidden.has(team.id)),
      visible = rows.filter((row) => row.time >= min && row.time <= max),
      values = visible
        .flatMap((row) =>
          teams.map(
            (team) => row.snapshot?.top4.find((t) => t.id === team.id)?.votes,
          ),
        )
        .filter(Number.isFinite),
      axis = MMAAxis.fit(values, "votes", 4);
    const box = { x: 72, y: 16, w: W - 90, h: H - 62 },
      x = (t) => box.x + ((t - min) / (max - min)) * box.w,
      y = (v) => box.y + ((axis.max - v) / (axis.max - axis.min)) * box.h;
    geometry = { min, max, width: box.w, box, W };
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.dataset.start = min;
    svg.dataset.end = max;
    const grid = axis.ticks
      .map(
        (v) =>
          `<line x1="${box.x}" x2="${W - 18}" y1="${y(v)}" y2="${y(v)}" stroke="#30414f" stroke-dasharray="2 4"/><text x="${box.x - 8}" y="${y(v) + 3}" text-anchor="end">${format(v)}</text>`,
      )
      .join("");
    const paths = teams
      .map((team) => {
        let d = "",
          active = false;
        for (const row of rows) {
          const value = row.snapshot?.top4.find((t) => t.id === team.id)?.votes;
          if (value == null) {
            active = false;
            continue;
          }
          d +=
            (active ? "L" : "M") +
            x(row.time).toFixed(1) +
            "," +
            y(value).toFixed(1) +
            " ";
          active = true;
        }
        return `<path d="${d}" fill="none" stroke="${escape(team.color || "#65d9ca")}" stroke-width="1.5"/>`;
      })
      .join("");
    svg.innerHTML = `<defs><clipPath id="plot"><rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}"/></clipPath></defs>${grid}<g clip-path="url(#plot)">${paths}</g><text x="${box.x}" y="${H - 15}">${date(min)}</text><text x="${W - 18}" y="${H - 15}" text-anchor="end">${date(max)}</text>`;
    $("chart-range").textContent = rows.some((row) => row.snapshot)
      ? date(min) + " ~ " + date(max) + " KST"
      : "관측 기록이 쌓이면 추이를 표시합니다.";
  }
  async function refresh() {
    if (loading) return;
    loading = true;
    $("refresh").disabled = true;
    render();
    if (!archiveTask)
      archiveTask = TrackerHTTP.record(
        "multi-history.json",
        (value) => {
          if (value.schemaVersion !== 1 || !Array.isArray(value.records))
            throw new Error("Invalid archive");
          return value;
        },
        true,
      )
        .then((value) => update(value.records))
        .catch(() => {})
        .finally(() => {
          archiveTask = null;
        });
    const live =
      Date.now() >= Date.parse(C.endsAt)
        ? []
        : C.sources.map(async (source) => {
            if (!source.endpoint) {
              failures[source.id] = true;
              return;
            }
            try {
              const value = await TrackerHTTP.json(source.endpoint, {
                timeout: 10000,
              });
              const snapshot = TrackerSources.parse(
                source,
                value,
                new Date().toISOString(),
              );
              failures[source.id] = false;
              update([snapshot]);
            } catch {
              failures[source.id] = true;
              render();
            }
          });
    await Promise.all(live);
    loading = false;
    $("refresh").disabled = false;
    render();
    if (archiveTask) await archiveTask;
  }
  $("tabs").onclick = (e) => {
    const button = e.target.closest("[data-view]");
    if (!button) return;
    view = button.dataset.view;
    windowRange = null;
    for (const tab of $("tabs").children)
      tab.setAttribute("aria-pressed", String(tab === button));
    render();
  };
  $("legend").onclick = (e) => {
    const button = e.target.closest("[data-team]");
    if (!button) return;
    const id = button.dataset.team;
    if (hidden.has(id)) hidden.delete(id);
    else if (hidden.size < C.candidates.length - 1) hidden.add(id);
    render();
  };
  $("day").onchange = (e) => {
    chosenDate = e.target.value;
    daily();
  };
  $("refresh").onclick = refresh;
  function zoom(factor, ratio = 0.5) {
    const g = geometry,
      span = (g.max - g.min) * factor,
      center = g.min + (g.max - g.min) * ratio;
    setRange(center - span * ratio, center + span * (1 - ratio));
  }
  $("zoom-in").onclick = () => zoom(0.5);
  $("zoom-out").onclick = () => zoom(2);
  $("reset").onclick = () => {
    windowRange = null;
    chart();
  };
  const fraction = (x) => {
    const r = $("trend").getBoundingClientRect();
    return Math.max(
      0,
      Math.min(
        1,
        (((x - r.left) * geometry.W) / r.width - geometry.box.x) /
          geometry.box.w,
      ),
    );
  };
  function startGesture() {
    const pts = [...pointers.values()];
    if (!pts.length) {
      gesture = null;
      return;
    }
    const center = pts.length > 1 ? (pts[0].x + pts[1].x) / 2 : pts[0].x;
    gesture = {
      ...geometry,
      center,
      anchor: geometry.min + fraction(center) * (geometry.max - geometry.min),
      distance:
        pts.length > 1
          ? Math.max(1, Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y))
          : null,
    };
  }
  $("trend").onpointerdown = (e) => {
    if (e.button > 0) return;
    e.preventDefault();
    $("trend").setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    startGesture();
  };
  $("trend").onpointermove = (e) => {
    if (!pointers.has(e.pointerId) || !gesture) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...pointers.values()],
      g = gesture;
    if (pts.length > 1 && g.distance) {
      const span = Math.max(
          60000,
          ((g.max - g.min) * g.distance) /
            Math.max(1, Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y)),
        ),
        left = g.anchor - fraction((pts[0].x + pts[1].x) / 2) * span;
      setRange(left, left + span);
    } else {
      const shift = ((pts[0].x - g.center) / g.width) * (g.max - g.min);
      setRange(g.min - shift, g.max - shift);
    }
  };
  for (const name of ["pointerup", "pointercancel", "lostpointercapture"])
    $("trend").addEventListener(name, (e) => {
      pointers.delete(e.pointerId);
      startGesture();
    });
  $("trend").addEventListener(
    "wheel",
    (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      zoom(e.deltaY < 0 ? 0.5 : 2, fraction(e.clientX));
    },
    { passive: false },
  );
  let resize;
  window.addEventListener("resize", () => {
    clearTimeout(resize);
    resize = setTimeout(chart, 120);
  });
  render();
  refresh();
})();
