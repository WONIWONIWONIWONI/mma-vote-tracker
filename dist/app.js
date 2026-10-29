/* VOTE/TRACK: observed points only; straight lines bridge missing observations. */
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const nf = new Intl.NumberFormat("ko-KR");
  const config = TrackerConfig;
  const colors = Object.fromEntries(config.teams.map((t) => [t.id, t.color]));
  const gapDefs = [
    [0, 1],
    [1, 2],
    [2, 3],
    [0, 2],
    [0, 3],
    [1, 3],
  ].map(([a, b]) => ({
    a,
    b,
    name: `${a + 1}–${b + 1}위`,
  }));
  function rankGap(s, g) {
    return s.top4[g.a].votes - s.top4[g.b].votes;
  }
  const state = {
    data: window.MMA_SEED,
    metric: "votes",
    hiddenTeams: new Set(
      config.teams
        .filter((t) => !config.defaultVisibleIds.includes(t.id))
        .map((t) => t.id),
    ),
    zoom: 1,
    timeZoom: 1,
    timeEnd: null,
    yView: null,
    forecastMinutes: 30,
    forecast: true,
    range: "24",
    historyLimit: 12,
    dailyDate: null,
    leadersExpanded: false,
    hourlyDate: null,
    hourlyLimit: 6,
    fetching: false,
    loadFailed: false,
    historyLoaded: false,
    archive: null,
    localObservations: [],
    archiveFailed: false,
  };
  const escapeHTML = (value) =>
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
  const fmt = (n) => nf.format(n);
  const share = (team, snap) => (100 * team.votes) / snap.totalVotes;
  const displayShare = (team, snap) => share(team, snap).toFixed(2);
  const normalizedId = (team) =>
    String(team.id || team.name)
      .normalize("NFKC")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
  function baseColorOf(team) {
    const id = normalizedId(team);
    if (colors[id]) return colors[id];
    const used = new Set(Object.values(colors));
    const extra = ["#a96a00", "#20213b", "#ab469e", "#617d00"];
    return (colors[id] = extra.find((c) => !used.has(c)) || "#71738b");
  }
  function colorOf(team) {
    return TrackerTheme.color(baseColorOf(team));
  }
  function kst(iso, mode = "full") {
    const d = new Date(iso);
    const p = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(d);
    const f = Object.fromEntries(p.map((x) => [x.type, x.value]));
    return mode === "time"
      ? `${f.hour}:${f.minute}`
      : mode === "short"
        ? `${f.month}.${f.day} ${f.hour}:${f.minute}`
        : `${f.year}.${f.month}.${f.day} ${f.hour}:${f.minute}`;
  }
  const normalize = MMAData.normalize;
  const melonURL = config.sources[0].endpoint;
  const operationEnd = () => Date.parse(config.endsAt);
  const votingEnd = () => Date.parse(config.votingEndsAt || config.endsAt);
  const latest = () => state.data.snapshots.at(-1);
  function getSeries() {
    return latest()
      .top4.filter((t) => !state.hiddenTeams.has(t.id))
      .map((t) => ({ id: t.id, name: t.name, color: colorOf(t) }));
  }
  function getValue(s, series) {
    const team = s.top4.find((t) => t.id === series.id);
    return team
      ? state.metric === "share"
        ? share(team, s)
        : team.votes
      : null;
  }
  function windowSnapshots() {
    const all = state.data.snapshots;
    if (state.range === "all") return all;
    const min = Date.parse(latest().sourceAt) - Number(state.range) * 3600000;
    return all.filter((s) => Date.parse(s.sourceAt) >= min);
  }
  function change(v, digits = 0) {
    return `${v > 0 ? "+" : v < 0 ? "−" : ""}${digits ? Math.abs(v).toFixed(digits) : fmt(Math.abs(v))}`;
  }
  function status() {
    const last = latest(),
      age = Math.max(
        0,
        Math.floor((Date.now() - Date.parse(last.sourceAt)) / 60000),
      );
    const stopped = Date.now() >= operationEnd(),
      direct = last.origin === "melon_browser_api";
    $("status-pill").className =
      "status-pill " +
      (state.loadFailed || age >= 2 || stopped ? "stale" : "live");
    $("status-label").textContent = stopped
      ? "수집 종료"
      : state.loadFailed
        ? "직접 조회 실패"
        : direct
          ? "멜론 직접 조회"
          : "보관 기록";
    $("source-time").textContent = stopped
      ? `${kst(last.sourceAt)}:${String(new Date(last.sourceAt).getUTCSeconds()).padStart(2, "0")} KST`
      : kst(last.sourceAt);
    $("collected-time").textContent = stopped
      ? "기록 보관용"
      : `${age < 1 ? "1분 미만" : age + "분"} 전 관측`;
    let note = stopped
      ? "수집 기간이 끝났습니다. 마지막 기록을 표시합니다."
      : state.loadFailed
        ? "최신 조회에 실패했습니다. 마지막 관측값을 표시합니다."
        : "";
    if (!stopped && state.archive?.collector?.state === "error")
      note += " 수집기 재시도 중.";
    if (state.archiveFailed) note += " 과거 기록을 불러오는 중입니다.";
    const archiveLast = state.archive?.snapshots.at(-1),
      archiveAge = archiveLast
        ? Math.floor((Date.now() - Date.parse(archiveLast.sourceAt)) / 60000)
        : 0;
    if (archiveLast && archiveAge >= 15 && !stopped)
      note += ` 추이용 공용 이력은 ${kst(archiveLast.sourceAt, "time")}까지입니다 (${archiveAge}분 전).`;

    $("notice-text").textContent = note;
    $("notice").hidden = !note.trim();
    $("notice").className =
      "notice " + (!state.loadFailed && age < 2 ? "good" : "");
  }
  function renderCards() {
    const last = latest();
    $("leaders").innerHTML = last.top4
      .map(
        (t, i) =>
          `<article id="leader-rank-${i + 1}" ${i >= 2 && !state.leadersExpanded ? "hidden" : ""} class="leader ${i === 0 ? "first" : ""}" style="--color:${colorOf(t)}"><div class="leader-top"><span class="rank-badge"><b>${String(i + 1).padStart(2, "0")}</b>위</span></div><h2 class="artist" title="${escapeHTML(t.name)}"><i class="artist-dot"></i><span class="artist-name">${escapeHTML(t.name)}</span></h2><div class="count-row"><span class="vote-total"><strong class="vote-value">${fmt(t.votes)}</strong><span class="unit">표</span></span><span class="share-value">${displayShare(t, last)}<span>%</span></span></div><div class="leader-bottom"><b>${i === 0 ? `2위와 ${fmt(t.votes - last.top4[1].votes)}표 차이` : `${i}위와 ${fmt(last.top4[i - 1].votes - t.votes)}표 차이`}</b></div></article>`,
      )
      .join("");
    $("leaders-toggle").setAttribute(
      "aria-expanded",
      String(state.leadersExpanded),
    );
    $("leaders-toggle").textContent = state.leadersExpanded
      ? "3~6위 접기 ▴"
      : "3~6위 더보기 ▾";
    $("total-votes").textContent = fmt(last.totalVotes);
    $("sample-count").textContent = fmt(state.data.snapshots.length);
    const sum = last.top4.reduce((s, t) => s + t.votes, 0);
    $("top-share").textContent =
      ((sum / last.totalVotes) * 100).toFixed(1) + "%";
    $("other-share").textContent =
      (((last.totalVotes - sum) / last.totalVotes) * 100).toFixed(1) + "%";
    $("share-track").innerHTML =
      last.top4
        .map(
          (t) =>
            `<i style="width:${share(t, last)}%;background:${colorOf(t)}" title="${escapeHTML(t.name)} ${displayShare(t, last)}%"></i>`,
        )
        .join("") +
      `<i style="width:${100 - (sum / last.totalVotes) * 100}%;background:#e8eaf1" title="그 외"></i>`;
  }
  function renderDaily() {
    const now = Math.min(Date.now(), operationEnd()),
      teams = latest().top4,
      dailyRows = [
        ...new Map(
          [...(state.archive?.snapshots || []), ...state.data.snapshots].map(
            (row) => [row.sourceAt, row],
          ),
        ).values(),
      ],
      days = MMADaily.build(dailyRows, teams, now).filter(
        (day) => day.start < votingEnd(),
      );
    const selected = days.some((d) => d.date === state.dailyDate)
        ? state.dailyDate
        : days[0]?.date,
      today = days.find((d) => d.date === selected);
    $("daily-date").innerHTML = days
      .map(
        (d) =>
          `<option value="${d.date}" ${d.date === selected ? "selected" : ""}>${d.date.replaceAll("-", ".")} KST${d.ongoing ? " / 오늘" : ""}</option>`,
      )
      .join("");
    if (!today) {
      $("daily-summary").textContent = "오늘 관측을 기다리고 있습니다.";
      $("daily-teams").innerHTML = "";
      return;
    }
    const number = (v) => (v == null ? "—" : change(v) + "표"),
      boundaryTime = (t) => {
        const second = new Date(t).getUTCSeconds();
        return (
          kst(t, "short") +
          (second ? ":" + String(second).padStart(2, "0") : "")
        );
      },
      range = (d) =>
        d.from == null
          ? "관측 대기"
          : `${boundaryTime(d.from)} → ${boundaryTime(d.to)}`;
    $("daily-title").textContent =
      `${today.date.replaceAll("-", ".")} 하루 누적 득표 증가량`;
    $("daily-summary").innerHTML =
      `<span class="panel-tag">${today.ongoing ? "집계 중" : "마감"}${today.partial ? " / 일부 구간" : ""}</span><span>전체 후보 합계 <strong>${number(today.total)}</strong></span><small>${range(today)} KST</small>`;
    const ranked = today.values
        .slice()
        .sort((a, b) => (b.delta ?? -Infinity) - (a.delta ?? -Infinity)),
      max = Math.max(0, ...ranked.map((v) => v.delta ?? 0));
    $("daily-teams").innerHTML = ranked
      .map(
        (v) =>
          `<div class="daily-team ${v.delta === max && max > 0 ? "daily-winner" : ""}" style="--color:${colorOf(v)}"><span class="daily-name"><i></i>${escapeHTML(v.name)}${v.delta === max && max > 0 ? " <b>최다 증가</b>" : ""}</span><strong>${number(v.delta)}</strong><div class="daily-bar"><i style="width:${max ? (Math.max(0, v.delta ?? 0) / max) * 100 : 0}%"></i></div></div>`,
      )
      .join("");
    $("daily-note").textContent = "";
    $("daily-head").innerHTML =
      '<tr><th scope="col">날짜 / 상태</th><th scope="col">전체 후보</th>' +
      teams
        .map(
          (t) =>
            `<th scope="col" style="color:${colorOf(t)}">${escapeHTML(t.name)}</th>`,
        )
        .join("") +
      "</tr>";
    $("daily-body").innerHTML =
      days
        .slice(1)
        .map((d) => {
          const peak = Math.max(0, ...d.values.map((v) => v.delta ?? 0));
          return `<tr><th scope="row">${d.date}<small>마감${d.partial ? " / 일부 구간" : ""}</small><small>${range(d)}</small></th><td>${number(d.total)}</td>${d.values.map((v) => `<td class="${v.delta === peak && peak > 0 ? "daily-best" : ""}">${number(v.delta)}${v.delta === peak && peak > 0 ? " ★" : ""}</td>`).join("")}</tr>`;
        })
        .join("") ||
      `<tr><td colspan="${teams.length + 2}">아직 마감한 날짜가 없습니다.</td></tr>`;
    const mobileHistory = matchMedia("(max-width: 760px)").matches,
      historyDetails = $("daily-history-mobile").closest("details"),
      recordOpen = new Map(
        [...$("daily-history-mobile").querySelectorAll(".daily-record")].map(
          (record) => [record.dataset.date, record.open],
        ),
      );
    if (mobileHistory && !historyDetails.dataset.mobileExpanded) {
      historyDetails.open = true;
      historyDetails.dataset.mobileExpanded = "true";
    }
    $("daily-history-mobile").innerHTML =
      days
        .slice(1)
        .map((d) => {
          const peak = Math.max(0, ...d.values.map((v) => v.delta ?? 0));
          return `<details class="daily-record" data-date="${d.date}" ${(recordOpen.get(d.date) ?? mobileHistory) ? "open" : ""}><summary><span>${d.date}</span><strong>${number(d.total)}</strong></summary><p>마감${d.partial ? " / 일부 구간" : ""}<br>${range(d)} KST</p><dl>${d.values.map((v) => `<div class="${v.delta === peak && peak > 0 ? "daily-best" : ""}"><dt style="color:${colorOf(v)}">${escapeHTML(v.name)}</dt><dd>${number(v.delta)}${v.delta === peak && peak > 0 ? " ★" : ""}</dd></div>`).join("")}</dl></details>`;
        })
        .join("") || "<p>아직 마감한 날짜가 없습니다.</p>";
  }
  function renderHistory() {
    const all = [...state.data.snapshots].reverse();
    $("history-count").textContent = `${fmt(all.length)}회 관측`;
    $("history-body").innerHTML = all
      .slice(0, state.historyLimit)
      .map((s) => {
        const teamCells = Array.from({ length: config.topN }, (_, i) => {
          const t = s.top4[i];
          return t
            ? `<td><span class="history-name">${escapeHTML(t.name)}</span>${fmt(t.votes)}<span class="history-name" style="display:inline;margin-left:7px">${displayShare(t, s)}%</span></td>`
            : '<td class="no-value">—</td>';
        }).join("");
        return `<tr><td>${kst(s.sourceAt, "short")}${s.origin === "user_capture" ? " / 캡처" : ""}</td>${teamCells}${gapDefs.map((g) => `<td>${fmt(rankGap(s, g))}표</td>`).join("")}</tr>`;
      })
      .join("");
    $("load-more").hidden = all.length <= state.historyLimit;
  }
  function hourlyModel() {
    const teams = latest().top4,
      all = MMAHourly.build(state.data.snapshots, teams),
      dates = [
        ...new Set(
          all
            .filter((row) => row.date <= MMADaily.dayKey(votingEnd() - 1))
            .map((r) => r.date),
        ),
      ];
    const date = dates.includes(state.hourlyDate) ? state.hourlyDate : dates[0];
    return { teams, dates, date, rows: all.filter((r) => r.date === date) };
  }
  function hourWinner(row) {
    const valid = row.values.filter((v) => v.delta != null);
    if (!valid.length) return { ids: [], label: "기록 대기" };
    if (new Set(valid.map((v) => v.from + ":" + v.to)).size > 1)
      return { ids: [], label: "관측 구간 다름" };
    const max = Math.max(...valid.map((v) => v.delta));
    if (max <= 0)
      return { ids: [], label: max === 0 ? "증가 없음" : "득표 감소" };
    return {
      ids: valid.filter((v) => v.delta === max).map((v) => v.id),
      label: valid.length < row.values.length ? "관측 팀 중 최다" : "최다 증가",
    };
  }
  function renderHourly() {
    const { teams, dates, date, rows } = hourlyModel(),
      mobile = matchMedia("(max-width:760px)").matches;
    const limit = mobile && state.hourlyLimit === 6 ? 3 : state.hourlyLimit,
      shown = rows.slice(0, limit);
    const shortName = (t) =>
      config.teams.find((v) => v.id === t.id)?.name || t.name;
    $("hourly-date").innerHTML = dates
      .map(
        (d) =>
          `<option value="${d}"${d === date ? " selected" : ""}>${d.replaceAll("-", ".")} KST</option>`,
      )
      .join("");
    const table =
      `<table class="hourly-compact"><thead><tr><th>시간 / 최다 증가</th>${teams.map((t) => `<th style="color:${colorOf(t)}">${escapeHTML(t.name)}</th>`).join("")}</tr></thead><tbody>` +
      shown
        .map((row) => {
          const winner = hourWinner(row),
            best = teams.filter((t) => winner.ids.includes(t.id)),
            max = Math.max(1, ...row.values.map((v) => Math.abs(v.delta ?? 0))),
            end =
              MMAHourly.dayKey(row.end) !== row.date
                ? "24:00"
                : kst(row.end, "time");
          return (
            `<tr><th><b>${kst(row.start, "time")}–${end}</b><small>${best.length ? escapeHTML(best.map((t) => t.name).join(" / ")) + " ★" : winner.label}</small><em>${row.ongoing ? "집계 중" : row.values.every((v) => v.complete) ? "1시간 전체" : "일부 구간"}</em></th>` +
            teams
              .map((t) => {
                const v = row.values.find((v) => v.id === t.id),
                  coverage =
                    v.delta == null
                      ? "기록 부족"
                      : `${kst(v.from, "time")}–${kst(v.to, "time")} 관측`;
                return `<td class="${winner.ids.includes(t.id) ? "hour-winner" : ""}" style="--color:${colorOf(t)}" title="${coverage}"><strong>${v.delta == null ? "—" : change(v.delta)}</strong><span class="mini-bar"><i style="width:${(Math.abs(v.delta ?? 0) / max) * 100}%"></i></span><small>${v.complete ? "" : coverage}</small></td>`;
              })
              .join("") +
            "</tr>"
          );
        })
        .join("") +
      "</tbody></table>";
    const cards = shown
      .map((row) => {
        const winner = hourWinner(row),
          best = teams.filter((t) => winner.ids.includes(t.id)),
          max = Math.max(1, ...row.values.map((v) => Math.abs(v.delta ?? 0))),
          end =
            MMAHourly.dayKey(row.end) !== row.date
              ? "24:00"
              : kst(row.end, "time");
        const label = row.ongoing
          ? "집계 중"
          : row.values.every((v) => v.complete)
            ? "1시간 전체"
            : "일부 구간";
        const lead = best.length
          ? `${best.length > 1 ? "공동 " : ""}최다 증가 / ${escapeHTML(best.map(shortName).join(" / "))} <b>${change(row.values.find((v) => v.id === best[0].id).delta)}표</b>`
          : winner.label;
        return (
          `<article class="hour-card"><div class="hour-card-head"><h3>${kst(row.start, "time")}–${end}</h3><span>${label}</span></div><p class="hour-card-winner">${lead}</p><div class="hour-card-grid">` +
          teams
            .map((t) => {
              const v = row.values.find((v) => v.id === t.id),
                coverage =
                  v.delta == null
                    ? "기록 부족"
                    : v.complete
                      ? ""
                      : `${kst(v.from, "time")}–${kst(v.to, "time")} 관측`;
              return `<div class="hour-card-team ${winner.ids.includes(t.id) ? "hour-card-best" : ""}" style="--color:${colorOf(t)}"><div><span class="hour-card-name">${escapeHTML(shortName(t))}</span><strong>${v.delta == null ? "—" : change(v.delta) + "표"}</strong></div><span class="mini-bar"><i style="width:${(Math.abs(v.delta ?? 0) / max) * 100}%"></i></span>${coverage ? `<small>${coverage}</small>` : ""}</div>`;
            })
            .join("") +
          "</div></article>"
        );
      })
      .join("");
    $("hourly-list").innerHTML =
      `<div class="hourly-desktop">${table}</div><div class="hourly-cards">${cards}</div>`;
    $("hourly-more").hidden = rows.length <= limit;
    $("hourly-more").textContent = `이날 전체 시간 보기 (${rows.length}개)`;
    $("hourly-note").textContent = "";
  }
  function axisLabel(value, axis) {
    return state.metric === "share"
      ? value.toFixed(axis.decimals) + "%"
      : fmt(Math.round(value));
  }
  function axisRangeLabel(g) {
    return `세로축 표시 범위 / ${axisLabel(g.ymin, g.axis)}–${axisLabel(g.ymax, g.axis)}${state.metric === "share" ? "" : "표"}`;
  }
  function graphGeometry() {
    const rows = windowSnapshots(),
      series = getSeries(),
      lastTime = Date.parse(latest().sourceAt);
    const W = Math.max(
        240,
        Math.floor($("trend-chart").getBoundingClientRect().width || 800),
      ),
      H = W < 600 ? 400 : 450;
    const forecasts = state.forecast
      ? series.flatMap((line) => {
          const source = state.data.snapshots.filter(
            (r) => Date.parse(r.sourceAt) >= lastTime - 3600000,
          );
          if (
            source.some(
              (r, i) =>
                i &&
                (() => {
                  const a = source[i - 1].top4.find((t) => t.id === line.id),
                    b = r.top4.find((t) => t.id === line.id);
                  return a && b && b.votes < a.votes;
                })(),
            )
          )
            return [];
          const points = source
            .map((r) => ({ t: Date.parse(r.sourceAt), v: getValue(r, line) }))
            .filter((p) => p.v != null);
          const f = MMAAnalytics.forecast(points, 60, state.forecastMinutes);
          if (!f || f.time !== lastTime) return [];
          return [
            {
              ...line,
              ...f,
              points: f.points.map((p) => ({
                ...p,
                value: Math.max(
                  0,
                  Math.min(state.metric === "share" ? 100 : Infinity, p.value),
                ),
              })),
            },
          ];
        })
      : [];
    const baseRows = rows,
      all = state.data.snapshots;
    let baseXmin = Date.parse(baseRows[0].sourceAt),
      baseXmax = Math.max(
        lastTime,
        ...forecasts.map((f) => f.points.at(-1).time),
      );
    if (baseXmin === baseXmax) {
      baseXmin -= 300000;
      baseXmax += 300000;
    }
    const timeSpan = (baseXmax - baseXmin) / state.timeZoom,
      minTimeEnd = Math.min(baseXmax, Date.parse(all[0].sourceAt) + timeSpan);
    const xmax = Math.max(
        minTimeEnd,
        Math.min(baseXmax, state.timeEnd ?? baseXmax),
      ),
      xmin = xmax - timeSpan;
    let visible = all.filter(
      (r) => Date.parse(r.sourceAt) >= xmin && Date.parse(r.sourceAt) <= xmax,
    );
    const before = all.findLast((r) => Date.parse(r.sourceAt) < xmin),
      after = all.find((r) => Date.parse(r.sourceAt) > xmax);
    if (before) visible.unshift(before);
    if (after) visible.push(after);
    if (!visible.length) visible = [latest()];
    const predictedValues = forecasts.flatMap((f) => {
      const a = Math.max(xmin, f.time),
        b = Math.min(xmax, f.points.at(-1).time);
      return b < a
        ? []
        : [a, b].map((t) =>
            Math.max(
              0,
              Math.min(
                state.metric === "share" ? 100 : Infinity,
                f.last + (f.slope * (t - f.time)) / 60000,
              ),
            ),
          );
    });
    const values = visible
      .flatMap((r) => series.map((line) => getValue(r, line)))
      .filter(Number.isFinite)
      .concat(predictedValues);
    const baseAxis = MMAAxis.fit(values, state.metric, W < 600 ? 4 : 5);
    const span = Math.max(
      state.metric === "share" ? 0.0004 : 4,
      (baseAxis.max - baseAxis.min) / state.zoom,
    );
    const focusRow =
        visible.filter((r) => Date.parse(r.sourceAt) <= xmax).at(-1) ||
        latest(),
      focus = getValue(focusRow, { id: $("trend-focus").value });
    const center = Number.isFinite(focus)
      ? focus
      : (baseAxis.min + baseAxis.max) / 2;
    const autoMin =
      state.zoom > 1
        ? Math.max(
            baseAxis.min,
            Math.min(baseAxis.max - span, center - span / 2),
          )
        : baseAxis.min;
    let ymin = state.yView?.min ?? autoMin,
      ymax =
        state.yView?.max ??
        autoMin + (state.zoom > 1 ? span : baseAxis.max - baseAxis.min);
    const ceiling = state.metric === "share" ? 100 : Infinity;
    if (ymin < 0) {
      ymax -= ymin;
      ymin = 0;
    }
    if (ymax > ceiling) {
      ymin = Math.max(0, ymin - ymax + ceiling);
      ymax = ceiling;
    }
    const step = (ymax - ymin) / 4,
      decimals =
        state.metric === "share"
          ? Math.max(2, Math.min(6, Math.ceil(-Math.log10(step)) + 1))
          : 0;
    const axis =
      state.zoom === 1 && !state.yView
        ? baseAxis
        : {
            ...baseAxis,
            min: ymin,
            max: ymax,
            decimals,
            ticks: Array.from({ length: 5 }, (_, i) => ymin + i * step),
          };
    const left = Math.max(
        55,
        Math.max(...axis.ticks.map((v) => axisLabel(v, axis).length)) * 6.5 +
          14,
      ),
      box = { x: left, y: 24, w: W - left - 15, h: H - 72 };
    return {
      rows: visible,
      series,
      forecasts,
      lastTime,
      W,
      H,
      box,
      xmin,
      xmax,
      baseXmin,
      baseXmax,
      minTimeEnd,
      baseAxis,
      axis,
      ymin,
      ymax,
      x: (t) => box.x + ((t - xmin) / (xmax - xmin)) * box.w,
      y: (v) => box.y + box.h - ((v - ymin) / (ymax - ymin)) * box.h,
    };
  }

  function renderChart() {
    const g = graphGeometry(),
      { rows, series, forecasts, lastTime, W, H, box, x, y, xmin, xmax, axis } =
        g,
      svg = $("trend-chart");
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.style.height = `${H}px`;
    svg.dataset.ymin = g.ymin;
    svg.dataset.ymax = g.ymax;
    svg.dataset.xmin = xmin;
    svg.dataset.xmax = xmax;
    svg.style.touchAction = "none";
    svg.style.cursor = trendDrag ? "grabbing" : "grab";
    svg.dataset.zoomX = state.timeZoom;
    svg.dataset.zoomY = state.zoom;
    $("chart-unit").textContent =
      state.metric === "share" ? "전체 대비 점유율 (%)" : "득표수 (표)";
    $("chart-axis-note").textContent =
      `시간축 ${Number(state.timeZoom.toFixed(1))}배 / 세로 ${Number(state.zoom.toFixed(1))}배 / ${axisRangeLabel(g)}`;
    $("chart-legend").innerHTML = latest()
      .top4.map(
        (t) =>
          `<button class="legend-item team-toggle ${state.hiddenTeams.has(t.id) ? "muted-team" : ""}" data-team="${escapeHTML(t.id)}" aria-pressed="${!state.hiddenTeams.has(t.id)}" style="--color:${colorOf(t)}"><i></i>${escapeHTML(t.name)}</button>`,
      )
      .join("");
    const grid = axis.ticks.map(
      (v) =>
        `<line x1="${box.x}" y1="${y(v)}" x2="${box.x + box.w}" y2="${y(v)}" stroke="#e8eaf1" stroke-dasharray="3 5"/><text x="${box.x - 9}" y="${y(v) + 4}" text-anchor="end" fill="#71738b" font-size="12">${axisLabel(v, axis)}</text>`,
    );
    const n = W < 480 ? 3 : 6;
    for (let i = 0; i < n; i++) {
      const t = xmin + ((xmax - xmin) * i) / (n - 1);
      grid.push(
        `<text x="${x(t)}" y="${H - 20}" text-anchor="${i === 0 ? "start" : i === n - 1 ? "end" : "middle"}" fill="#71738b" font-size="12">${kst(t, "time")}</text>`,
      );
    }
    const futureX = Math.max(box.x, Math.min(box.x + box.w, x(lastTime))),
      futureWidth = box.x + box.w - futureX;
    if (forecasts.length && xmax > lastTime)
      grid.push(
        `<rect x="${futureX}" y="${box.y}" width="${futureWidth}" height="${box.h}" fill="#6055f50b"/><line x1="${futureX}" x2="${futureX}" y1="${box.y}" y2="${box.y + box.h}" stroke="#71738b" stroke-dasharray="3 5"/><text x="${futureX + 5}" y="15" fill="#6055f5" font-size="12">점선: 조건부 예측</text>`,
      );
    const path = (points) => {
      let active = false;
      return points
        .map((p) => {
          if (p.value == null) {
            active = false;
            return "";
          }
          const cmd = active ? "L" : "M";
          active = true;
          return `${cmd}${x(p.time)},${y(p.value)}`;
        })
        .join(" ");
    };
    let lines = series
      .map(
        (line) =>
          `<path d="${path(rows.map((r) => ({ time: Date.parse(r.sourceAt), value: getValue(r, line) })))}" fill="none" stroke="${line.color}" stroke-width="1.2"/>`,
      )
      .join("");
    lines += forecasts
      .map(
        (f) =>
          `<path d="${path(f.points)}" fill="none" stroke="${f.color}" stroke-width="1.2" stroke-dasharray="5 5"/>`,
      )
      .join("");
    const hits = rows
      .map(
        (r, i) =>
          `<rect x="${x(Date.parse(r.sourceAt)) - Math.max(2, Math.min(16, box.w / rows.length / 2))}" y="${box.y}" width="${Math.max(4, Math.min(32, box.w / rows.length))}" height="${box.h}" fill="transparent" data-point="${i}" tabindex="0" aria-label="${kst(r.sourceAt)} 실제 관측"/>`,
      )
      .join("");
    const future =
      forecasts.length && xmax > lastTime
        ? `<rect x="${futureX}" y="${box.y}" width="${futureWidth}" height="${box.h}" fill="transparent" id="forecast-hit"/>`
        : "";
    svg.innerHTML = `<title>선택한 팀의 실제 추이와 조건부 예측</title><defs><clipPath id="trend-clip"><rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}"/></clipPath></defs>${grid.join("")}<g clip-path="url(#trend-clip)">${lines}${hits}${future}</g>`;
    svg.querySelectorAll("[data-point]").forEach((el) => {
      const show = () => {
        if (!trendDrag) showTooltip(rows[+el.dataset.point], series, el, g);
      };
      el.addEventListener("pointerenter", show);
      el.addEventListener("focus", show);
      el.addEventListener("pointerleave", hideTooltip);
      el.addEventListener("blur", hideTooltip);
    });
    const fh = svg.querySelector("#forecast-hit");
    if (fh) {
      fh.addEventListener("pointermove", (e) => {
        if (trendDrag) return;
        const r = svg.getBoundingClientRect(),
          px = ((e.clientX - r.left) * W) / r.width,
          t = Math.max(
            lastTime,
            Math.min(xmax, xmin + ((px - box.x) / box.w) * (xmax - xmin)),
          );
        const tt = $("tooltip");
        tt.innerHTML =
          `<strong>${kst(t)} / 예측(실제값 아님)</strong>` +
          forecasts
            .filter((f) => t <= f.points.at(-1).time)
            .map(
              (f) =>
                `<p><span style="color:${f.color}">${escapeHTML(f.name)}</span><b>${state.metric === "share" ? Math.max(0, Math.min(100, f.last + (f.slope * (t - lastTime)) / 60000)).toFixed(2) + "%" : fmt(Math.round(Math.max(0, f.last + (f.slope * (t - lastTime)) / 60000))) + "표"}</b></p>`,
            )
            .join("");
        tt.hidden = false;
        tt.style.left =
          Math.max(
            0,
            Math.min(
              r.width - tt.offsetWidth,
              e.clientX - r.left - tt.offsetWidth,
            ),
          ) + "px";
        tt.style.top = "38px";
      });
      fh.addEventListener("pointerleave", hideTooltip);
    }
    const gapModels = forecasts.filter((f) => f.hasGaps),
      gapNote = gapModels.length
        ? ` / 최대 ${Math.max(...gapModels.map((f) => f.maxGap)).toFixed(1)}분 관측 공백 포함 / 추정 신뢰도 낮음`
        : "";
    $("chart-note").textContent =
      `실선: 관측값${state.forecast ? ` / 점선: ${state.forecastMinutes}분 조건부 예측` : ""}${gapModels.length ? " / 관측 공백 포함" : ""}`;
    $("chart-window").textContent =
      `${kst(xmin, "short")} — ${kst(xmax, "short")}${xmax > lastTime ? " (예측 구간 포함)" : " 실제 관측 구간"}`;
  }
  function showTooltip(s, series, el, g) {
    const tt = $("tooltip");
    tt.innerHTML =
      `<strong>${kst(s.sourceAt)} KST</strong>` +
      series
        .map((line) => {
          const v = getValue(s, line);
          return `<p><span><i style="background:${line.color}"></i>${escapeHTML(line.name)}</span><b>${v == null ? "—" : state.metric === "share" ? v.toFixed(2) + "%" : fmt(v) + "표"}</b></p>`;
        })
        .join("");
    tt.hidden = false;
    const wrap = $("trend-chart").getBoundingClientRect();
    const p = (g.x(Date.parse(s.sourceAt)) / g.W) * wrap.width;
    tt.style.left =
      Math.max(0, Math.min(wrap.width - tt.offsetWidth, p + 12)) + "px";
    tt.style.top = "38px";
  }
  function hideTooltip() {
    $("tooltip").hidden = true;
  }
  function render() {
    renderDaily();
    status();
    renderCards();
    renderHistory();
    renderChart();
    renderHourly();
    window.MMA_DATA = state.data;
    window.dispatchEvent(new CustomEvent("mma:data", { detail: state.data }));
  }
  function mergeRecent(current, recent) {
    const rows = new Map(
      current.snapshots.map((s) => [
        Math.floor(Date.parse(s.sourceAt) / 60000),
        s,
      ]),
    );
    recent.snapshots.forEach((s) =>
      rows.set(Math.floor(Date.parse(s.sourceAt) / 60000), s),
    );
    // A long absence or a historical edit requires a full resync, not an invented gap.
    if (
      !Number.isSafeInteger(recent.historyCount) ||
      rows.size !== recent.historyCount
    )
      return null;
    return normalize({ ...recent, snapshots: [...rows.values()] });
  }
  const fetchRecord = (file) => TrackerHTTP.record(file, normalize);
  function applyData() {
    if (Date.now() >= operationEnd()) state.localObservations = [];
    state.data = normalize(
      MMAData.combine(state.archive || state.data, state.localObservations),
    );
    render();
  }
  async function loadArchive() {
    try {
      let candidate;
      if (!state.historyLoaded) candidate = await fetchRecord("history.json");
      else {
        const recent = await fetchRecord("latest.json");
        candidate =
          mergeRecent(state.archive, recent) ||
          (await fetchRecord("history.json"));
      }
      if (
        candidate.historyCount != null &&
        candidate.historyCount !== candidate.snapshots.length
      )
        throw new Error("Incomplete archive");
      if (
        state.archive &&
        Date.parse(candidate.snapshots.at(-1).sourceAt) <
          Date.parse(state.archive.snapshots.at(-1).sourceAt)
      )
        throw new Error("Older archive");
      state.archive = candidate;
      state.historyLoaded = true;
      state.archiveFailed = false;
    } catch {
      state.archiveFailed = true;
    }
    applyData();
  }
  async function refresh(manual = false) {
    if (state.fetching || location.protocol === "file:") return;
    state.fetching = true;
    $("refresh-button").disabled = true;
    // Start archival sync independently: a slow GitHub response must not delay live cards.
    if (!state.archiveTask)
      state.archiveTask = loadArchive()
        .catch(() => {
          state.archiveFailed = true;
          status();
        })
        .finally(() => {
          state.archiveTask = null;
        });
    try {
      if (Date.now() < operationEnd()) {
        const payload = await TrackerHTTP.json(melonURL, { timeout: 10000 });
        if (Date.now() >= operationEnd()) return;
        const snapshot = MMAData.parse(payload, new Date().toISOString());
        state.localObservations = MMAData.merge(state.localObservations, [
          snapshot,
        ]);
        state.loadFailed = false;
        applyData();
        if (manual) toast("멜론에서 최신 수치를 직접 조회했습니다.");
      }
    } catch {
      state.loadFailed = true;
      render();
      if (manual) toast("멜론 직접 조회 실패 / 마지막 확인값을 유지합니다.");
    } finally {
      state.fetching = false;
      $("refresh-button").disabled = false;
    }
  }
  function toast(text) {
    $("toast").textContent = text;
    $("toast").hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => ($("toast").hidden = true), 4200);
  }
  function download(blob, name) {
    const u = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = u;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(u), 10000);
  }
  function exportCSV() {
    const cells = (v) => {
      let s = String(v ?? "");
      if (/^[=+@\-]/.test(s)) s = "'" + s;
      return '"' + s.replace(/"/g, '""') + '"';
    };
    const rows = [
      [
        "집계시각_KST",
        "출처",
        "전체투표",
        "순위",
        "아티스트",
        "득표수",
        "전체대비점유율_%",
        "표시점유율_%",
        ...gapDefs.map((g) => g.name + "표차"),
      ],
    ];
    for (const s of state.data.snapshots)
      for (const t of s.top4)
        rows.push([
          kst(s.sourceAt),
          s.origin,
          s.totalVotes,
          t.rank,
          t.name,
          t.votes,
          share(t, s).toFixed(4),
          displayShare(t, s),
          ...gapDefs.map((g) => rankGap(s, g)),
        ]);
    download(
      new Blob(
        ["\uFEFF" + rows.map((r) => r.map(cells).join(",")).join("\r\n")],
        { type: "text/csv;charset=utf-8" },
      ),
      `${config.id}-history.csv`,
    );
  }
  async function copySummary() {
    const s = latest();
    const lines = [
      `[${config.edition}] ${kst(s.sourceAt)} KST 기준`,
      ...s.top4.map(
        (t) =>
          `${t.rank}위 ${t.name}: ${fmt(t.votes)}표 (${displayShare(t, s)}%)`,
      ),
      ...gapDefs.map((g) => `${g.name} 표차: ${fmt(rankGap(s, g))}표`),
      `총투표수 ${fmt(s.totalVotes)}표`,
      s.origin === "user_capture"
        ? "첨부 화면에서 확인한 기록 / 실시간 연결 전"
        : "Melon 공개 투표 집계",
      location.protocol === "file:" ? config.sources[0].url : location.href,
    ];
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      toast("집계 요약을 복사했습니다.");
    } catch {
      toast("복사 권한이 없습니다. CSV 다운로드를 이용해 주세요.");
    }
  }
  function imageModel(type) {
    const last = latest(),
      stamp = kst(last.sourceAt),
      suffix = stamp.replace(/[^0-9]/g, "");
    const common = {
      type,
      sourceAt: stamp,
      filename: `${config.id}-${type}-${suffix}.png`,
    };
    const leaders = last.top4.map((team, i) => {
      const other = last.top4[i === 0 ? 1 : i - 1];
      return {
        rank: team.rank,
        name: team.name,
        color: colorOf(team),
        votes: fmt(team.votes) + "표",
        share: displayShare(team, last) + "%",
        shareValue: share(team, last),
        gap: `${other.rank}위 ${other.name}와 ${fmt(Math.abs(team.votes - other.votes))}표 차이`,
      };
    });
    if (type === "leaders")
      return {
        ...common,
        title: "현재 득표 현황",
        subtitle: "득표수, 득표율, 순위 간 표차",
        leaders,
      };
    if (type === "trend") {
      const g = graphGeometry();
      return {
        ...common,
        title: "현재 득표 현황과 추이",
        subtitle: "그래프 기간 / " + $("chart-window").textContent + " KST",
        chartTitle: $("chart-unit").textContent + " 추이",
        leaders,
        xmin: g.xmin,
        xmax: g.xmax,
        ymin: g.ymin,
        ymax: g.ymax,
        ticks: g.axis.ticks.map((value) => ({
          value,
          label: axisLabel(value, g.axis),
        })),
        series: g.series.map((line) => ({
          ...line,
          points: g.rows.map((row) => ({
            time: Date.parse(row.sourceAt),
            value: getValue(row, line),
          })),
        })),
        firstLabel: kst(g.rows[0].sourceAt, "short"),
        lastLabel: kst(g.xmax, "short") + (g.forecasts.length ? " 예측" : ""),
        forecasts: g.forecasts,
        lastTime: g.lastTime,
        rangeNote: axisRangeLabel(g),
        note: $("chart-note").textContent,
        filename: `${config.id}-trend-${state.metric}-${suffix}.png`,
      };
    }
    if (type === "hourly") {
      const teams = last.top4,
        date = $("hourly-date").value;
      const rows = MMAHourly.build(state.data.snapshots, teams).filter(
        (row) => row.date === date,
      );
      return {
        ...common,
        title: "시간대별 득표 증가량",
        subtitle: date.replaceAll("-", ".") + " / 전체 시간대",
        filename: `${config.id}-hourly-${date}.png`,
        max: Math.max(
          1,
          ...rows.flatMap((row) =>
            row.values.map((value) => Math.abs(value.delta ?? 0)),
          ),
        ),
        rows: rows.map((row) => {
          const complete = row.values.every((value) => value.complete),
            empty = row.values.every((value) => value.delta == null);
          const end =
            MMAHourly.dayKey(row.end) !== row.date
              ? "24:00"
              : kst(row.end, "time");
          return {
            label: kst(row.start, "time") + "–" + end,
            complete,
            status: empty
              ? "비교 기록 대기"
              : complete
                ? "1시간 전체"
                : row.ongoing
                  ? "집계 중"
                  : "일부 구간",
            values: teams.map((team) => {
              const value = row.values.find((value) => value.id === team.id);
              return {
                ...value,
                name: team.name,
                color: colorOf(team),
                label: value.delta == null ? "—" : change(value.delta) + "표",
                coverage:
                  value.delta == null
                    ? "비교할 관측 기록이 부족합니다."
                    : value.complete
                      ? ""
                      : `${kst(value.from, "time")}–${kst(value.to, "time")} 실제 관측 (${fmt((value.to - value.from) / 60000)}분)`,
              };
            }),
          };
        }),
      };
    }
    throw new Error("Unknown image panel.");
  }
  window.MMAShareModels = {
    leaders: () => imageModel("leaders"),
    trend: () => imageModel("trend"),
    hourly: () => imageModel("hourly"),
  };
  let imagePending = false;
  async function exportPanel(button) {
    if (imagePending) {
      toast("이미지를 준비하고 있습니다.");
      return;
    }
    imagePending = true;
    button.disabled = true;
    let canvas;
    try {
      // Capture the selected data before fonts load or another update arrives.
      const model = imageModel(button.dataset.image);
      await document.fonts.ready;
      canvas = MMAImages.render(model);
      const blob = await new Promise((resolve, reject) =>
        canvas.toBlob(
          (value) =>
            value ? resolve(value) : reject(new Error("Empty image.")),
          "image/png",
        ),
      );
      download(blob, model.filename);
    } catch {
      toast("이미지를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      if (canvas) {
        canvas.width = 1;
        canvas.height = 1;
      }
      imagePending = false;
      button.disabled = false;
    }
  }
  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-image]");
    if (button) exportPanel(button);
  });
  document.querySelectorAll("[data-metric]").forEach((button) =>
    button.addEventListener("click", () => {
      state.metric = button.dataset.metric;
      document.querySelectorAll("[data-metric]").forEach((b) => {
        b.classList.toggle("selected", b === button);
        b.setAttribute("aria-pressed", String(b === button));
      });
      state.yView = null;
      hideTooltip();
      renderChart();
    }),
  );
  document.querySelectorAll("[data-range]").forEach((button) =>
    button.addEventListener("click", () => {
      state.range = button.dataset.range;
      state.timeZoom = 1;
      state.timeEnd = null;
      state.yView = null;
      document.querySelectorAll("[data-range]").forEach((b) => {
        b.classList.toggle("selected", b === button);
        b.setAttribute("aria-pressed", String(b === button));
      });
      state.yView = null;
      hideTooltip();
      renderChart();
    }),
  );
  $("leaders-toggle").addEventListener("click", () => {
    state.leadersExpanded = !state.leadersExpanded;
    renderCards();
  });
  $("hourly-date").addEventListener("change", (event) => {
    state.hourlyDate = event.target.value;
    state.hourlyLimit = 6;
    renderHourly();
  });
  $("hourly-more").addEventListener("click", () => {
    state.hourlyLimit = 24;
    renderHourly();
  });
  $("daily-date").addEventListener("change", (e) => {
    state.dailyDate =
      e.target.value === MMADaily.dayKey(Math.min(Date.now(), votingEnd() - 1))
        ? null
        : e.target.value;
    renderDaily();
  });
  window.addEventListener("mma:forecast-due", () => refresh());
  $("refresh-button").addEventListener("click", () => refresh(true));
  $("csv-button").addEventListener("click", exportCSV);
  $("copy-button").addEventListener("click", copySummary);
  $("load-more").addEventListener("click", () => {
    state.historyLimit += 12;
    renderHistory();
  });
  $("history-details").addEventListener("toggle", () => {
    $("history-toggle-label").textContent = $("history-details").open
      ? "접기"
      : "펼치기";
  });
  window.addEventListener("tracker:theme", () => {
    if (state.data) render();
  });
  window.addEventListener("tracker:panel", (event) => {
    if (event.detail === "trend-panel") renderChart();
  });
  let resizeTimer;
  addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      renderChart();
      renderHourly();
    }, 120);
  });
  $("chart-legend").addEventListener("click", (e) => {
    const b = e.target.closest("[data-team]");
    if (!b) return;
    const id = b.dataset.team;
    if (state.hiddenTeams.has(id)) state.hiddenTeams.delete(id);
    else if (getSeries().length > 1) state.hiddenTeams.add(id);
    state.zoom = 1;
    state.yView = null;
    hideTooltip();
    renderChart();
  });
  function setChartZoom(nextX, nextY, anchor = { x: 0.5, y: 0.5 }) {
    const g = graphGeometry(),
      atTime = g.xmin + anchor.x * (g.xmax - g.xmin),
      atValue = g.ymax - anchor.y * (g.ymax - g.ymin);
    const spanY = Math.max(
      state.metric === "share" ? 0.0004 : 4,
      ((g.ymax - g.ymin) * state.zoom) / nextY,
    );
    state.timeZoom = nextX;
    state.yView = {
      min: atValue - (1 - anchor.y) * spanY,
      max: atValue + anchor.y * spanY,
    };
    state.zoom = nextY;
    state.timeEnd =
      atTime + ((1 - anchor.x) * (g.baseXmax - g.baseXmin)) / nextX;
    hideTooltip();
    renderChart();
  }
  $("trend-focus").addEventListener("change", () => {
    state.hiddenTeams.delete($("trend-focus").value);
    state.yView = null;
    hideTooltip();
    renderChart();
  });
  let trendDrag = null,
    trendPinch = null;
  const trendPointers = new Map();
  function chartPointer(clientX, clientY, g = graphGeometry()) {
    const rect = $("trend-chart").getBoundingClientRect();
    return {
      x: Math.max(
        0,
        Math.min(
          1,
          (((clientX - rect.left) * g.W) / rect.width - g.box.x) / g.box.w,
        ),
      ),
      y: Math.max(
        0,
        Math.min(
          1,
          (((clientY - rect.top) * g.H) / rect.height - g.box.y) / g.box.h,
        ),
      ),
    };
  }
  function startTrendDrag(id, x, y) {
    const g = graphGeometry(),
      rect = $("trend-chart").getBoundingClientRect();
    trendDrag = {
      id,
      x,
      y,
      g,
      width: (g.box.w * rect.width) / g.W,
      height: (g.box.h * rect.height) / g.H,
    };
  }
  $("trend-chart").addEventListener("pointerdown", (e) => {
    if (e.button > 0) return;
    $("trend-chart").setPointerCapture(e.pointerId);
    hideTooltip();
    e.preventDefault();
    if (e.pointerType === "touch") {
      trendPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (trendPointers.size >= 2) {
        const [a, b] = [...trendPointers.values()],
          g = graphGeometry();
        trendPinch = {
          g,
          zoom: state.zoom,
          timeZoom: state.timeZoom,
          distance: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)),
          anchor: chartPointer((a.x + b.x) / 2, (a.y + b.y) / 2, g),
        };
        trendDrag = null;
        return;
      }
    }
    startTrendDrag(e.pointerId, e.clientX, e.clientY);
  });
  $("trend-chart").addEventListener("pointermove", (e) => {
    if (trendPointers.has(e.pointerId))
      trendPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (trendPinch && trendPointers.size >= 2) {
      const [a, b] = [...trendPointers.values()],
        p = trendPinch,
        g = p.g,
        ratio = Math.hypot(b.x - a.x, b.y - a.y) / p.distance,
        anchor = chartPointer((a.x + b.x) / 2, (a.y + b.y) / 2);
      const nextX = Math.max(1, Math.min(16, p.timeZoom * ratio)),
        nextY = Math.max(1, Math.min(16, p.zoom * ratio)),
        spanY = Math.max(
          state.metric === "share" ? 0.0004 : 4,
          ((g.ymax - g.ymin) * p.zoom) / nextY,
        );
      const atTime = g.xmin + p.anchor.x * (g.xmax - g.xmin),
        atValue = g.ymax - p.anchor.y * (g.ymax - g.ymin);
      state.timeZoom = nextX;
      state.zoom = nextY;
      state.timeEnd =
        atTime + ((1 - anchor.x) * (g.baseXmax - g.baseXmin)) / nextX;
      state.yView = {
        min: atValue - (1 - anchor.y) * spanY,
        max: atValue + anchor.y * spanY,
      };
      hideTooltip();
      renderChart();
      return;
    }
    if (!trendDrag || e.pointerId !== trendDrag.id) return;
    const d = trendDrag,
      g = d.g,
      dy = ((e.clientY - d.y) / d.height) * (g.ymax - g.ymin);
    state.timeEnd = Math.max(
      g.minTimeEnd,
      Math.min(
        g.baseXmax,
        g.xmax - ((e.clientX - d.x) / d.width) * (g.xmax - g.xmin),
      ),
    );
    state.yView = { min: g.ymin + dy, max: g.ymax + dy };
    hideTooltip();
    renderChart();
  });
  function endTrendDrag(e) {
    if (e.pointerType === "touch") {
      if (!trendPointers.has(e.pointerId)) return;
      trendPointers.delete(e.pointerId);
      trendPinch = null;
      if (trendPointers.size === 1) {
        const [id, p] = [...trendPointers.entries()][0];
        startTrendDrag(id, p.x, p.y);
        return;
      }
    }
    if (trendDrag?.id === e.pointerId || !trendPointers.size) {
      trendDrag = null;
      $("trend-chart").style.cursor = "grab";
      hideTooltip();
    }
  }
  ["pointerup", "pointercancel", "lostpointercapture"].forEach((name) =>
    $("trend-chart").addEventListener(name, endTrendDrag),
  );
  ["gesturestart", "gesturechange", "gestureend"].forEach((name) =>
    $("trend-chart").addEventListener(name, (e) => e.preventDefault(), {
      passive: false,
    }),
  );
  $("trend-chart").addEventListener(
    "wheel",
    (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const g = graphGeometry(),
        rect = $("trend-chart").getBoundingClientRect();
      const anchor = {
          x: Math.max(
            0,
            Math.min(
              1,
              (((e.clientX - rect.left) * g.W) / rect.width - g.box.x) /
                g.box.w,
            ),
          ),
          y: Math.max(
            0,
            Math.min(
              1,
              (((e.clientY - rect.top) * g.H) / rect.height - g.box.y) /
                g.box.h,
            ),
          ),
        },
        factor = e.deltaY < 0 ? 2 : 0.5;
      setChartZoom(
        Math.max(1, Math.min(16, state.timeZoom * factor)),
        Math.max(1, Math.min(16, state.zoom * factor)),
        anchor,
      );
    },
    { passive: false },
  );
  $("trend-forecast").addEventListener("change", (e) => {
    state.forecast = e.target.checked;
    state.timeEnd = null;
    state.yView = null;
    hideTooltip();
    renderChart();
  });
  $("trend-forecast-minutes").addEventListener("change", (e) => {
    state.forecastMinutes = +e.target.value;
    state.timeEnd = null;
    state.timeZoom = 1;
    state.yView = null;
    hideTooltip();
    renderChart();
  });
  $("trend-reset").addEventListener("click", () => {
    state.zoom = 1;
    state.timeZoom = 1;
    state.timeEnd = null;
    state.yView = null;
    hideTooltip();
    renderChart();
  });
  $("trend-focus").innerHTML = config.teams
    .map(
      (t) =>
        `<option value="${escapeHTML(t.id)}">${escapeHTML(t.name)}</option>`,
    )
    .join("");
  state.data = normalize(state.data);
  state.archive = state.data;
  render();
  if (location.protocol !== "file:") refresh();
  if (Date.now() < operationEnd()) {
    setTimeout(() => refresh(), operationEnd() - Date.now() + 30000);
  }
  setInterval(() => {
    status();
    renderDaily();
  }, 30000);
})();
