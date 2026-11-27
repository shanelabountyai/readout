'use strict';
// The hand-entered weekly sheet (D-024, D-047): `weekly` values (header row first, FORMATTED_VALUE strings)
// and `definitions` (key, label, unit). No free text passes through: only parsed numbers, keys and labels
// declared by the owner in `definitions`, and issue codes.
const num = require('./num');
const week = require('./week');

const MAX_EXTRAS = 5;
const KEY_RE = /^[a-z][a-z0-9_]{0,30}$/;
const LABEL_RE = /^[A-Za-z0-9 ()&/.-]{1,40}$/; // labels reach the model: short, plain, no free text (D-066)

function parseDefinitions(values) {
  const issues = [];
  const rows = (values || []).slice(1);
  const defs = [];
  for (const r of rows) {
    const [key, label, unit] = (r || []).map((c) => String(c ?? '').trim());
    if (!key) continue;
    if (!KEY_RE.test(key) || !LABEL_RE.test(label || key) || !['usd', 'count'].includes(unit) || ['revenue', 'cash', 'week_start', 'revenue_usd', 'cash_usd'].includes(key)) {
      issues.push({ code: 'sheet_invalid', metric: 'definitions', weekStart: null });
      continue;
    }
    if (defs.some((d) => d.key === key)) continue;
    if (defs.length >= MAX_EXTRAS) { issues.push({ code: 'sheet_invalid', metric: 'definitions', weekStart: null }); continue; }
    defs.push({ key, label: label || key, unit });
  }
  return { defs, issues };
}

// window: the five weeks from week.reportWeek, oldest first.
function read(weeklyValues, definitionsValues, window) {
  const { defs, issues } = parseDefinitions(definitionsValues);
  const header = ((weeklyValues || [])[0] || []).map((h) => String(h ?? '').trim());
  const col = (name) => header.indexOf(name);
  const metrics = [
    { key: 'revenue', column: 'revenue_usd', unit: 'usd' },
    { key: 'cash', column: 'cash_usd', unit: 'usd' },
    ...defs.map((d) => ({ key: `x_${d.key}`, column: d.key, unit: d.unit })),
  ];
  const series = {};
  for (const m of metrics) series[m.key] = window.map(() => null);
  const wanted = new Map(window.map((w, i) => [w.weekStart, i]));
  const seen = new Set();
  const reportIdx = window.length - 1;
  const rowFor = new Array(window.length).fill(false);

  for (const r of (weeklyValues || []).slice(1)) {
    const cells = r || [];
    if (cells.every((c) => String(c ?? '').trim() === '')) continue;
    const ws = String(cells[col('week_start')] ?? '').trim();
    if (!week.parseMonday(ws)) { issues.push({ code: 'sheet_invalid', metric: 'week_start', weekStart: null }); continue; }
    if (seen.has(ws)) { issues.push({ code: 'sheet_invalid', metric: 'week_start', weekStart: ws }); continue; } // first row wins
    seen.add(ws);
    if (!wanted.has(ws)) continue;
    const i = wanted.get(ws);
    rowFor[i] = true;
    for (const m of metrics) {
      const c = col(m.column);
      const cell = c < 0 ? '' : String(cells[c] ?? '').trim();
      if (cell === '') {
        if (i === reportIdx) issues.push({ code: 'sheet_missing', metric: m.key, weekStart: ws });
        continue;
      }
      const p = m.unit === 'usd' ? num.parseDollars(cell) : num.parseCount(cell);
      if (!p.ok) { issues.push({ code: 'sheet_invalid', metric: m.key, weekStart: ws }); continue; }
      series[m.key][i] = m.unit === 'usd' ? p.cents : p.value;
    }
  }
  if (!rowFor[reportIdx]) issues.push({ code: 'sheet_missing', metric: null, weekStart: window[reportIdx].weekStart });
  return { series, defs, metrics, issues };
}

module.exports = { MAX_EXTRAS, read, parseDefinitions };
