'use strict';
// AC-04 (comparisons). Each case is a PRD §9 row; renderings checked through facts in golden.test.js.
const test = require('node:test');
const assert = require('node:assert');
const { compare } = require('../src/compare');
const F = require('../src/facts');
const M = '−';

const r = (series, type) => {
  const c = compare(series);
  const facts = F.build([{ key: 'm', label: 'm', type }], { m: c }, { open_pipeline: 0, stalled: [], overdue_tasks: 0 });
  return Object.fromEntries(facts.filter((f) => f.metric === 'm').map((f) => [f.field, f.rendering]));
};
const $ = (d) => d * 100;

test('E01 new contacts 8,10,6,8 → 9: +1, +13% (12.5 rounds away), +1.0, +13%', () => {
  assert.deepStrictEqual(r([8, 10, 6, 8, 9], 'count'), { cur: '9', prev: '8', avg4: '8.0', wow_abs: '+1', wow_pct: '+13%', avg_abs: '+1.0', avg_pct: '+13%' });
});
test('E01 won value and revenue (money, rationals over 4)', () => {
  assert.deepStrictEqual(r([$(12000), 0, $(21000), $(9000), $(18000)], 'money'), { cur: '$18,000', prev: '$9,000', avg4: '$10,500', wow_abs: '+$9,000', wow_pct: '+100%', avg_abs: '+$7,500', avg_pct: '+71%' });
  assert.deepStrictEqual(r([$(40000), $(44000), $(38000), $(42000), $(46000)], 'money'), { cur: '$46,000', prev: '$42,000', avg4: '$41,000', wow_abs: '+$4,000', wow_pct: '+10%', avg_abs: '+$5,000', avg_pct: '+12%' });
});
test('E01 deals lost 1,1,0,2 → 1: −1, −50%, 0.0, 0%', () => {
  assert.deepStrictEqual(r([1, 1, 0, 2, 1], 'count'), { cur: '1', prev: '2', avg4: '1.0', wow_abs: `${M}1`, wow_pct: `${M}50%`, avg_abs: '0.0', avg_pct: '0%' });
});
test('E02 cash +$500 renders 0% with a positive exact sign; revenue $0 vs avg', () => {
  const c = compare([$(120000), $(118000), $(121000), $(119000), $(119500)]);
  assert.strictEqual(c.wow_abs, 50000);
  assert.deepStrictEqual(r([$(120000), $(118000), $(121000), $(119000), $(119500)], 'money'), { cur: '$119,500', prev: '$119,000', avg4: '$119,500', wow_abs: '+$500', wow_pct: '0%', avg_abs: '$0', avg_pct: '0%' });
  assert.deepStrictEqual(r([$(40000), $(44000), $(38000), $(42000), $(41000)], 'money').wow_pct, `${M}2%`);
  assert.deepStrictEqual(r([8, 10, 6, 8, 1], 'count').wow_pct, `${M}88%`);
});
test('E07 fractional average 8,10,7,8 → 9: avg4 8.3, avg_abs +0.8, avg_pct +9%', () => {
  assert.deepStrictEqual(r([8, 10, 7, 8, 9], 'count'), { cur: '9', prev: '8', avg4: '8.3', wow_abs: '+1', wow_pct: '+13%', avg_abs: '+0.8', avg_pct: '+9%' });
});
test('E09 revenue $30,000: −$12,000 (−29%), −$11,000 (−27%)', () => {
  const x = r([$(40000), $(44000), $(38000), $(42000), $(30000)], 'money');
  assert.deepStrictEqual([x.wow_abs, x.wow_pct, x.avg_abs, x.avg_pct], [`${M}$12,000`, `${M}29%`, `${M}$11,000`, `${M}27%`]);
});
test('E10 cash $105,000: −$14,000 (−12%), −$14,500 (−12%)', () => {
  const x = r([$(120000), $(118000), $(121000), $(119000), $(105000)], 'money');
  assert.deepStrictEqual([x.wow_abs, x.wow_pct, x.avg_abs, x.avg_pct], [`${M}$14,000`, `${M}12%`, `${M}$14,500`, `${M}12%`]);
});
test('E14 short history: no avg4, avg_abs or avg_pct; week-over-week still present', () => {
  const c = compare([null, null, $(38000), $(42000), $(46000)]);
  assert.strictEqual(c.sum4, null);
  assert.deepStrictEqual(r([null, null, $(38000), $(42000), $(46000)], 'money'), { cur: '$46,000', prev: '$42,000', wow_abs: '+$4,000', wow_pct: '+10%' });
});
test('E15 zero base: no wow_pct when prev is 0; avg4 0.8, +1.3, +167%; won value $8,250, +$9,750, +118%', () => {
  assert.deepStrictEqual(r([1, 0, 2, 0, 2], 'count'), { cur: '2', prev: '0', avg4: '0.8', wow_abs: '+2', avg_abs: '+1.3', avg_pct: '+167%' });
  assert.deepStrictEqual(r([$(12000), 0, $(21000), 0, $(18000)], 'money'), { cur: '$18,000', prev: '$0', avg4: '$8,250', wow_abs: '+$18,000', avg_abs: '+$9,750', avg_pct: '+118%' });
});
test('missing cur: prev and avg4 remain, the rest are absent; sum4 of 0 gives no avg_pct', () => {
  assert.deepStrictEqual(r([$(40000), $(44000), $(38000), $(42000), null], 'money'), { prev: '$42,000', avg4: '$41,000' });
  assert.strictEqual(compare([0, 0, 0, 0, 3]).avg_pct, null);
  assert.throws(() => compare([1, 2, 3]));
});
