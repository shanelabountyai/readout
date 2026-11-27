'use strict';
// AC-05
const test = require('node:test');
const assert = require('node:assert');
const FL = require('../src/flags');
const { compare } = require('../src/compare');
const F = require('../src/facts');
const H = require('./harness');

const labels = (id) => H.runWeek(id).flags.map(FL.label);
const T = H.baseCfg.thresholds;

test('AC-05: each flag fires on its golden week', () => {
  assert.deepStrictEqual(labels('E02'), ['quiet_week']);
  assert.deepStrictEqual(labels('E08'), ['stalled_deals']);
  assert.deepStrictEqual(labels('E10'), ['overdue_tasks', 'cash_drop']);
  assert.deepStrictEqual(labels('E09'), ['revenue_swing']);
  assert.deepStrictEqual(labels('E03'), ['sheet_missing']);
  assert.deepStrictEqual(labels('E19'), ['sheet_invalid:revenue']);
  assert.deepStrictEqual(labels('E14'), ['history_short:revenue', 'history_short:cash']);
  assert.deepStrictEqual(labels('E18'), ['demo_guard_skipped']);
  assert.deepStrictEqual(labels('E01-truncated'), ['hubspot_truncated']);
});

test('AC-05: no flag fires on E01 (every input below threshold)', () => {
  assert.deepStrictEqual(labels('E01'), []);
});

test('code-written sentences (PRD §5)', () => {
  const s = (id, code) => H.runWeek(id).flags.find((f) => f.code === code).sentence;
  assert.strictEqual(s('E09', 'revenue_swing'), 'Revenue is 27% below its 4-week average');
  assert.strictEqual(s('E10', 'cash_drop'), 'Cash fell 12% from last week');
  assert.strictEqual(s('E02', 'quiet_week'), 'Quiet week in the CRM');
  assert.strictEqual(s('E03', 'sheet_missing'), 'Revenue and cash not entered');
  assert.strictEqual(s('E18', 'demo_guard_skipped'), '1 CRM record outside the demo set was not counted');
  assert.strictEqual(s('E01-truncated', 'hubspot_truncated'), 'CRM read stopped at 23 records; counts may be low');
  assert.doesNotMatch(s('E19', 'sheet_invalid'), /46k/, 'the cell text never passes through (D-057)');
});

// Synthetic comparisons for the threshold edges.
const metricsList = F.historyMetrics(H.baseCfg);
function run({ revenue, cash, created = 0, contacts = 0 }) {
  const comparisons = {};
  for (const m of metricsList) comparisons[m.key] = compare([1, 1, 1, 1, 0]);
  comparisons.deals_created = compare([1, 1, 1, 1, created]);
  comparisons.new_contacts = compare([1, 1, 1, 1, contacts]);
  comparisons.revenue = compare(revenue);
  comparisons.cash = compare(cash);
  return FL.compute({ comparisons, snapshot: { stalled: [], overdue_tasks: 0, open_pipeline: 0 }, sheetIssues: [], metricsList, thresholds: T }).map((f) => f.code);
}
const FLAT = [100, 100, 100, 100, 100];

test('revenue_swing exactly at 25% fires, just under does not; either direction', () => {
  assert.ok(run({ revenue: [100, 100, 100, 100, 125], cash: FLAT }).includes('revenue_swing'));
  assert.ok(run({ revenue: [100, 100, 100, 100, 75], cash: FLAT }).includes('revenue_swing'));
  assert.ok(!run({ revenue: [100, 100, 100, 100, 124], cash: FLAT }).includes('revenue_swing'));
  assert.ok(!run({ revenue: [0, 0, 0, 0, 0], cash: FLAT }).includes('revenue_swing'), 'sum4 of 0 never fires (D-056)');
});

test('cash_drop at exactly 10% fires; cash rising never fires; prev ≤ 0 never fires', () => {
  assert.ok(run({ revenue: FLAT, cash: [100, 100, 100, 100, 90] }).includes('cash_drop'));
  assert.ok(!run({ revenue: FLAT, cash: [100, 100, 100, 100, 91] }).includes('cash_drop'));
  assert.ok(!run({ revenue: FLAT, cash: [100, 100, 100, 100, 200] }).includes('cash_drop'));
  assert.ok(!run({ revenue: FLAT, cash: [100, 100, 100, -100, -500] }).includes('cash_drop'));
});

test('D-038: quiet_week does not fire when revenue_swing or cash_drop does; contacts above the limit break quiet', () => {
  assert.deepStrictEqual(run({ revenue: FLAT, cash: FLAT, contacts: 2 }), ['quiet_week']);
  assert.deepStrictEqual(run({ revenue: FLAT, cash: FLAT, contacts: 3 }), []);
  assert.deepStrictEqual(run({ revenue: [100, 100, 100, 100, 50], cash: FLAT }), ['revenue_swing']);
  assert.deepStrictEqual(run({ revenue: FLAT, cash: [100, 100, 100, 100, 50] }), ['cash_drop']);
  assert.deepStrictEqual(run({ revenue: FLAT, cash: FLAT, created: 1 }), []);
});

test('flag order follows PRD §5', () => {
  assert.deepStrictEqual(FL.ORDER.slice(0, 5), ['quiet_week', 'stalled_deals', 'overdue_tasks', 'revenue_swing', 'cash_drop']);
});
