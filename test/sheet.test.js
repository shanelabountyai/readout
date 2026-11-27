'use strict';
const test = require('node:test');
const assert = require('node:assert');
const SH = require('../src/sheet');
const W = require('../src/week');
const H = require('./harness');

const window = W.reportWeek('2026-11-23T16:00:00Z', 'America/Chicago').window;
const HEAD = ['week_start', 'revenue_usd', 'cash_usd'];
const DEFS = [['key', 'label', 'unit']];

test('E03: no row for the report week → one sheet_missing issue; prior weeks still read', () => {
  const w = H.loadWeek('E03');
  const r = SH.read(w.sheet, w.definitions, window);
  assert.deepStrictEqual(r.issues, [{ code: 'sheet_missing', metric: null, weekStart: '2026-11-16' }]);
  assert.deepStrictEqual(r.series.revenue, [4000000, 4400000, 3800000, 4200000, null]);
});

test('E14: only three rows → nulls in prior weeks and no sheet_missing issue (D-047)', () => {
  const w = H.loadWeek('E14');
  const r = SH.read(w.sheet, w.definitions, window);
  assert.deepStrictEqual(r.issues, []);
  assert.deepStrictEqual(r.series.cash, [null, null, 12100000, 11900000, 12300000]);
});

test('E19: `46k` is sheet_invalid for revenue and read as not entered; cash unaffected', () => {
  const w = H.loadWeek('E19');
  const r = SH.read(w.sheet, w.definitions, window);
  assert.deepStrictEqual(r.issues, [{ code: 'sheet_invalid', metric: 'revenue', weekStart: '2026-11-16' }]);
  assert.strictEqual(r.series.revenue[4], null);
  assert.strictEqual(r.series.cash[4], 12300000);
});

test('a duplicate week_start is sheet_invalid and the first row wins; a date serial or non-Monday week_start is sheet_invalid', () => {
  const r = SH.read([HEAD, ['2026-11-16', '46,000', '1'], ['2026-11-16', '99,000', '1'], ['46342', '1', '1'], ['2026-11-17', '1', '1']], DEFS, window);
  assert.strictEqual(r.series.revenue[4], 4600000);
  assert.deepStrictEqual(r.issues.map((i) => [i.code, i.metric]), [['sheet_invalid', 'week_start'], ['sheet_invalid', 'week_start'], ['sheet_invalid', 'week_start']]);
});

test('extras from definitions: a count extra and a usd extra become x_<key> series; more than five are ignored with an issue', () => {
  const defs = [['key', 'label', 'unit'], ['calls', 'Discovery calls', 'count'], ['ar', 'Receivables', 'usd']];
  const r = SH.read([[...HEAD, 'calls', 'ar'], ['2026-11-16', '46,000', '123,000', '1,204', '$7,500.00']], defs, window);
  assert.strictEqual(r.series.x_calls[4], 1204);
  assert.strictEqual(r.series.x_ar[4], 750000);
  assert.deepStrictEqual(r.defs.map((d) => d.key), ['calls', 'ar']);
  const many = [['key', 'label', 'unit'], ...['a', 'b', 'c', 'd', 'e', 'f'].map((k) => [k, k, 'count'])];
  const m = SH.read([HEAD], many, window);
  assert.strictEqual(m.defs.length, SH.MAX_EXTRAS);
  assert.ok(m.issues.some((i) => i.code === 'sheet_invalid' && i.metric === 'definitions'));
  assert.ok(SH.read([[...HEAD, 'calls'], ['2026-11-16', '1', '1', '12.5']], [['key', 'label', 'unit'], ['calls', 'Calls', 'count']], window).issues.some((i) => i.metric === 'x_calls'));
});

test('an empty cell in the report week row is sheet_missing for that metric only (D-052)', () => {
  const r = SH.read([HEAD, ['2026-11-16', '$46,000.00', '']], DEFS, window);
  assert.deepStrictEqual(r.issues, [{ code: 'sheet_missing', metric: 'cash', weekStart: '2026-11-16' }]);
});
