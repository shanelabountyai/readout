'use strict';
// Flags (PRD §5): fixed rules, thresholds from config (D-028), integer cross-multiplication only. Each
// sentence is written here from renderings; the model never decides a flag.
const num = require('./num');

const ORDER = ['quiet_week', 'stalled_deals', 'overdue_tasks', 'revenue_swing', 'cash_drop', 'sheet_missing', 'sheet_invalid', 'history_short', 'hubspot_truncated', 'demo_guard_skipped'];
const CODES = new Set(ORDER);
const abs = (r) => r.replace(/^[+−-]/, '');

// input: { comparisons, snapshot, sheetIssues, metricsList, labels, skipped, truncated, readCounts, thresholds }
function compute(input) {
  const { comparisons: C, snapshot, sheetIssues = [], metricsList, thresholds: T } = input;
  const label = (key) => (metricsList.find((m) => m.key === key) || { label: key }).label;
  const flags = [];

  // revenue_swing: |4·cur − sum4| × 10000 ≥ bp × sum4 (sum4 > 0)
  const r = C.revenue;
  let swing = null;
  if (r && r.cur !== null && r.sum4 !== null && r.sum4 > 0) {
    const d = 4 * r.cur - r.sum4;
    if (Math.abs(d) * 10000 >= T.revenueSwingBp * r.sum4) {
      swing = { code: 'revenue_swing', sentence: `Revenue is ${abs(num.renderPct(r.avg_pct.num, r.avg_pct.den))} ${d < 0 ? 'below' : 'above'} its 4-week average` };
    }
  }
  // cash_drop: prev > 0, cur < prev, (prev − cur) × 10000 ≥ bp × prev
  const c = C.cash;
  let drop = null;
  if (c && c.cur !== null && c.prev !== null && c.prev > 0 && c.cur < c.prev && (c.prev - c.cur) * 10000 >= T.cashDropBp * c.prev) {
    drop = { code: 'cash_drop', sentence: `Cash fell ${abs(num.renderPct(c.wow_pct.num, c.wow_pct.den))} from last week` };
  }
  const cur = (k) => (C[k] ? C[k].cur : null);
  const quiet = ['deals_created', 'deals_moved', 'deals_won', 'deals_lost'].every((k) => cur(k) === 0) && cur('new_contacts') !== null && cur('new_contacts') <= T.quietMaxNewContacts && !swing && !drop;
  if (quiet) flags.push({ code: 'quiet_week', sentence: 'Quiet week in the CRM' });

  const st = snapshot.stalled;
  if (st.length >= 1) {
    flags.push({ code: 'stalled_deals', sentence: `${st.length} stalled deal${st.length === 1 ? '' : 's'} at week end: ${st.map((s) => `${s.name} (${s.stage}, idle ${s.idleDays} days)`).join('; ')}` });
  }
  if (snapshot.overdue_tasks >= T.overdueFlagMin) flags.push({ code: 'overdue_tasks', sentence: `${snapshot.overdue_tasks} tasks overdue as of the run` });
  if (swing) flags.push(swing);
  if (drop) flags.push(drop);

  for (const i of sheetIssues.filter((x) => x.code === 'sheet_missing')) {
    flags.push({ code: 'sheet_missing', metric: i.metric || undefined, sentence: i.metric ? `${label(i.metric)} not entered for this week` : 'Revenue and cash not entered' });
  }
  for (const i of sheetIssues.filter((x) => x.code === 'sheet_invalid')) {
    let sentence;
    if (i.metric === 'week_start') sentence = 'A week_start cell is not a Monday written as YYYY-MM-DD (or repeats a week); that row was ignored';
    else if (i.metric === 'definitions') sentence = 'A definitions row was ignored (bad key or unit, or more than five extras)';
    else sentence = `${label(i.metric)}: the ${i.weekStart} cell is not a dollar amount or count; treated as not entered`;
    flags.push({ code: 'sheet_invalid', metric: i.metric, sentence });
  }
  for (const m of metricsList) {
    const x = C[m.key];
    if (x && x.sum4 === null) flags.push({ code: 'history_short', metric: m.key, sentence: `${m.label} lacks one of the four prior weeks; no 4-week average` });
  }
  const tr = input.truncated || {};
  const objs = ['deals', 'contacts', 'tasks'].filter((k) => tr[k]);
  if (objs.length) {
    const n = objs.reduce((a, k) => a + ((input.readCounts || {})[k] || 0), 0);
    flags.push({ code: 'hubspot_truncated', sentence: `CRM read stopped at ${n} records; counts may be low` });
  }
  const sk = input.skipped || {};
  const skippedN = (sk.deals || 0) + (sk.contacts || 0) + (sk.tasks || 0);
  if (skippedN > 0) flags.push({ code: 'demo_guard_skipped', count: skippedN, sentence: `${skippedN} CRM record${skippedN === 1 ? '' : 's'} outside the demo set ${skippedN === 1 ? 'was' : 'were'} not counted` });
  return flags;
}

const label = (f) => (f.metric ? `${f.code}:${f.metric}` : f.code);

module.exports = { ORDER, CODES, compute, label };
