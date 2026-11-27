'use strict';
// Comparisons for one metric (PRD §4): cur, prev, sum4 (internal), avg4, wow_abs, wow_pct, avg_abs, avg_pct.
// Rationals stay exact: avg4 and avg_abs as {num, den: 4}; percentages as {num, den} with den > 0.

function pct(num, den) { return den < 0 ? { num: -num, den: -den } : { num, den }; }
const present = (v) => v !== null && v !== undefined;

// series: five values, oldest first (the last is the report week), each an integer or null.
function compare(series) {
  if (!Array.isArray(series) || series.length !== 5) throw new Error('compare needs a five-value series');
  const cur = present(series[4]) ? series[4] : null;
  const prev = present(series[3]) ? series[3] : null;
  const prior = series.slice(0, 4);
  const sum4 = prior.every(present) ? prior.reduce((a, b) => a + b, 0) : null;
  const out = { cur, prev, sum4, avg4: sum4 === null ? null : { num: sum4, den: 4 }, wow_abs: null, wow_pct: null, avg_abs: null, avg_pct: null };
  if (cur !== null && prev !== null) {
    out.wow_abs = cur - prev;
    if (prev !== 0) out.wow_pct = pct(100 * (cur - prev), prev);
  }
  if (cur !== null && sum4 !== null) {
    out.avg_abs = { num: 4 * cur - sum4, den: 4 };
    if (sum4 !== 0) out.avg_pct = pct(100 * (4 * cur - sum4), sum4);
  }
  return out;
}

module.exports = { compare };
