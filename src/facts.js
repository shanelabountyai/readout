'use strict';
// The metric catalogue and the fact table (PRD §4, §6). One table feeds the prompt, the checks and the Doc;
// every rendering comes from num.js. A fact's sign is the sign of its exact value, not of its rendering.
const num = require('./num');

const HUBSPOT_METRICS = [
  { key: 'deals_created', label: 'Deals created', type: 'count' },
  { key: 'deals_moved', label: 'Deals moved', type: 'count' },
  { key: 'deals_won', label: 'Deals won', type: 'count' },
  { key: 'won_amount', label: 'Won value (CRM)', type: 'money' },
  { key: 'deals_lost', label: 'Deals lost', type: 'count' },
  { key: 'new_contacts', label: 'New contacts', type: 'count' },
];
const SNAPSHOT_METRICS = [
  { key: 'open_pipeline', label: 'Open pipeline (as of the run)', type: 'money' },
  { key: 'stalled_deals', label: 'Stalled deals (at week end)', type: 'count' },
  { key: 'overdue_tasks', label: 'Overdue tasks (as of the run)', type: 'count' },
];
const FIELDS = ['cur', 'prev', 'avg4', 'wow_abs', 'wow_pct', 'avg_abs', 'avg_pct'];
const FIELD_LABEL = {
  cur: 'this week', prev: 'last week', avg4: '4-week average', wow_abs: 'change vs last week', wow_pct: 'percent change vs last week',
  avg_abs: 'difference vs 4-week average', avg_pct: 'percent difference vs 4-week average',
};
const DELTA = new Set(['wow_abs', 'wow_pct', 'avg_abs', 'avg_pct']);

// History metrics in PRD §4 order: HubSpot, revenue, cash, then the sheet's declared extras.
function historyMetrics(cfg, defs = []) {
  return [
    ...HUBSPOT_METRICS,
    { key: 'revenue', label: cfg.revenueLabel || 'Revenue (as entered)', type: 'money' },
    { key: 'cash', label: 'Cash at week end', type: 'money' },
    ...defs.map((d) => ({ key: `x_${d.key}`, label: d.label, type: d.unit === 'usd' ? 'money' : 'count' })),
  ];
}

function render(type, field, c) {
  const v = c[field];
  if (v === null || v === undefined) return null;
  if (field === 'wow_pct' || field === 'avg_pct') return { type: 'pct', rendering: num.renderPct(v.num, v.den), sign: num.sgn(v.num) };
  if (type === 'money') {
    if (field === 'cur' || field === 'prev') return { type, rendering: num.renderMoney(v), sign: num.sgn(v) };
    if (field === 'avg4') return { type, rendering: num.renderMoneyAvg(v.num), sign: num.sgn(v.num) };
    if (field === 'wow_abs') return { type, rendering: num.renderMoneyDelta(v), sign: num.sgn(v) };
    return { type, rendering: num.renderMoneyAvgDelta(v.num), sign: num.sgn(v.num) };
  }
  if (field === 'cur' || field === 'prev') return { type, rendering: num.renderCount(v), sign: num.sgn(v) };
  if (field === 'avg4') return { type, rendering: num.renderCountAvg(v.num), sign: num.sgn(v.num) };
  if (field === 'wow_abs') return { type, rendering: num.renderCountDelta(v), sign: num.sgn(v) };
  return { type, rendering: num.renderCountAvgDelta(v.num), sign: num.sgn(v.num) };
}

// comparisons: { metricKey: compare() output }; snapshot: metrics.compute().snapshot
function build(metricsList, comparisons, snapshot) {
  const out = [];
  for (const m of metricsList) {
    const c = comparisons[m.key];
    if (!c) continue;
    for (const field of FIELDS) {
      const r = render(m.type, field, c);
      if (r) out.push({ id: `${m.key}.${field}`, metric: m.key, field, label: `${m.label}, ${FIELD_LABEL[field]}`, type: r.type, rendering: r.rendering, sign: r.sign, isDelta: DELTA.has(field) });
    }
  }
  const snapVal = { open_pipeline: snapshot.open_pipeline, stalled_deals: snapshot.stalled.length, overdue_tasks: snapshot.overdue_tasks };
  for (const m of SNAPSHOT_METRICS) {
    const v = snapVal[m.key];
    out.push({ id: `${m.key}.cur`, metric: m.key, field: 'cur', label: m.label, type: m.type, rendering: m.type === 'money' ? num.renderMoney(v) : num.renderCount(v), sign: num.sgn(v), isDelta: false });
  }
  snapshot.stalled.forEach((s, i) => {
    out.push({ id: `stalled.${i + 1}.idle_days`, metric: 'stalled_deals', field: 'idle_days', label: `Idle days at week end, stalled deal ${i + 1} (${s.name})`, type: 'count', rendering: num.renderCount(s.idleDays), sign: num.sgn(s.idleDays), isDelta: false });
  });
  return out;
}

const byId = (facts) => new Map(facts.map((f) => [f.id, f]));

module.exports = { HUBSPOT_METRICS, SNAPSHOT_METRICS, FIELDS, FIELD_LABEL, historyMetrics, build, byId };
