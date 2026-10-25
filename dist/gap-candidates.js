/* Shared model descriptions. Selection runs on the collector only. */
(function (root) {
  const CANDIDATES = [
    { id: "base", name: "30분 패턴 최근 보정", options: {} },
    {
      id: "no-drift",
      name: "30분 패턴 최근 보정 제외",
      options: { driftWeight: 0 },
    },
    { id: "fine15", name: "15분 패턴 최근 보정", options: { slotMinutes: 15 } },
    { id: "previous-day", name: "전날 동일 시간 변동", options: null },
  ];
  if (typeof module !== "undefined" && module.exports)
    module.exports = CANDIDATES;
  else root.MMAGapCandidates = CANDIDATES;
})(globalThis);
