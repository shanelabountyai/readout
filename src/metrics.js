'use strict';
// Weekly metrics from normalised HubSpot records (PRD §4; D-004, D-015, D-022, D-023, D-033, D-040 to D-042,
// D-049). Every window is half-open [start, end). Counts and cents only; never names except stalled deals.

const DAY_MS = 86400000;
const ms = (iso) => (iso ? Date.parse(iso) : NaN);
const inWeek = (iso, w) => { const t = ms(iso); return t >= ms(w.startUtc) && t < ms(w.endUtc); };

// rules: rules/stale.json contents. Returns Map stage → max idle days (closed stages map to null).
function staleMap(rules) {
  const m = new Map();
  for (const r of rules || []) m.set(r.stage, r.closed === 'true' || r.closed === true || r.max_idle_days === '' ? null : Number(r.max_idle_days));
  return m;
}

function compute(records, window, cfg, rules) {
  const won = new Set(cfg.wonStages || []);
  const lost = new Set(cfg.lostStages || []);
  const isOpenStage = (s) => !won.has(s) && !lost.has(s);
  const keys = ['deals_created', 'deals_moved', 'deals_won', 'won_amount', 'deals_lost', 'new_contacts'];
  const series = Object.fromEntries(keys.map((k) => [k, window.map(() => 0)]));
  const notes = { wonMissingAmount: 0, openMissingAmount: 0, unknownStages: [] };

  window.forEach((w, i) => {
    for (const d of records.deals) {
      if (inWeek(d.createdAt, w)) series.deals_created[i]++;
      // moved: an entry in the week into an open stage that differs from the entry before it; never the first
      const h = d.stageHistory;
      for (let j = 1; j < h.length; j++) {
        if (inWeek(h[j].at, w) && isOpenStage(h[j].value) && h[j].value !== h[j - 1].value) { series.deals_moved[i]++; break; }
      }
      if (won.has(d.stage) && inWeek(d.closedAt, w)) {
        series.deals_won[i]++;
        if (d.amountCents === null) notes.wonMissingAmount++; else series.won_amount[i] += d.amountCents;
      }
      if (lost.has(d.stage) && inWeek(d.closedAt, w)) series.deals_lost[i]++;
    }
    for (const c of records.contacts) if (inWeek(c.createdAt, w)) series.new_contacts[i]++;
  });

  // snapshots (D-004): pipeline and overdue as of the run; stalled at the report week's end
  const end = ms(window[window.length - 1].endUtc);
  const limits = staleMap(rules);
  let openPipeline = 0;
  const stalled = [];
  const unknown = new Set();
  for (const d of records.deals) {
    if (!isOpenStage(d.stage)) continue;
    if (d.amountCents === null) notes.openMissingAmount++; else openPipeline += d.amountCents;
    if (!limits.has(d.stage)) { unknown.add(d.stage); continue; }
    const max = limits.get(d.stage);
    if (max === null) continue;
    const idleDays = Math.floor((end - ms(d.lastActivityAt)) / DAY_MS);
    if (idleDays > max) stalled.push({ name: d.name, stage: d.stage, idleDays });
  }
  stalled.sort((a, b) => b.idleDays - a.idleDays || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  notes.unknownStages = [...unknown].sort();
  const overdue = records.tasks.filter((t) => t.status !== 'COMPLETED' && t.dueAt && ms(t.dueAt) < end).length;

  return { series, snapshot: { open_pipeline: openPipeline, stalled, overdue_tasks: overdue }, notes };
}

module.exports = { compute, staleMap };
