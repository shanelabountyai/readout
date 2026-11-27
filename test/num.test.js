'use strict';
const test = require('node:test');
const assert = require('node:assert');
const N = require('../src/num');
const M = '−';

test('roundHalfAway: half away from zero, negatives, exact halves (D-006)', () => {
  const cases = [[5, 2, 3], [-5, 2, -3], [100, 3, 33], [-100, 2, -50], [1950, 4, 488], [125, 10, 13], [-125, 10, -13], [42, 100, 0], [0, 7, 0], [7, -2, -4]];
  for (const [n, d, want] of cases) assert.strictEqual(N.roundHalfAway(n, d), want, `${n}/${d}`);
  assert.throws(() => N.roundHalfAway(1.5, 2));
  assert.throws(() => N.roundHalfAway(1, 0));
});

test('one-decimal count averages and deltas: 8.25 → 8.3, 0.75 → 0.8, 0.42 → 0', () => {
  assert.strictEqual(N.renderCountAvg(33), '8.3'); // 8.25
  assert.strictEqual(N.renderCountAvg(12), '3.0');
  assert.strictEqual(N.renderCountAvgDelta(3), '+0.8'); // 0.75
  assert.strictEqual(N.renderCountAvgDelta(-3), `${M}0.8`);
  assert.strictEqual(N.renderCountAvgDelta(0), '0.0');
  assert.strictEqual(N.renderPct(500, 119000), '0%'); // 0.42%
  assert.strictEqual(N.renderPct(-700, 8), `${M}88%`); // −87.5 → −88
});

test('parseDollars accepts plain, commas, cents, $ and a leading minus; rejects the rest (D-047)', () => {
  assert.deepStrictEqual(N.parseDollars('46000'), { ok: true, cents: 4600000 });
  assert.deepStrictEqual(N.parseDollars('46,000'), { ok: true, cents: 4600000 });
  assert.deepStrictEqual(N.parseDollars('46000.50'), { ok: true, cents: 4600050 });
  assert.deepStrictEqual(N.parseDollars('$46,000'), { ok: true, cents: 4600000 });
  assert.deepStrictEqual(N.parseDollars('$46,000.00'), { ok: true, cents: 4600000 });
  assert.deepStrictEqual(N.parseDollars('-5,000'), { ok: true, cents: -500000 });
  assert.deepStrictEqual(N.parseDollars(`${M}5,000`), { ok: true, cents: -500000 });
  assert.deepStrictEqual(N.parseDollars('18000.00'), { ok: true, cents: 1800000 });
  for (const bad of ['46k', '4.5m', '46,00', '1.234', '($5,000)', '', '  ', '$', '1,2345', null]) assert.deepStrictEqual(N.parseDollars(bad), { ok: false }, String(bad));
});

test('renderings: money, deltas, percentages, counts; minus is U+2212', () => {
  assert.strictEqual(N.renderMoney(4600000), '$46,000');
  assert.strictEqual(N.renderMoneyDelta(400000), '+$4,000');
  assert.strictEqual(N.renderMoneyDelta(-1400000), `${M}$14,000`);
  assert.strictEqual(N.renderMoneyDelta(0), '$0');
  assert.strictEqual(N.renderMoneyAvg(4200000), '$10,500');
  assert.strictEqual(N.renderMoneyAvg(3300000), '$8,250');
  assert.strictEqual(N.renderMoneyAvg(195), '$0'); // 48.75 cents rounds to 0 dollars
  assert.strictEqual(N.renderPct(100, 3), '+33%');
  assert.strictEqual(N.renderPct(0, 3), '0%');
  assert.strictEqual(N.renderPct(-1, 2), `${M}1%`); // −0.5 → −1
  assert.strictEqual(N.renderCount(4), '4');
  assert.strictEqual(N.renderCountDelta(-1), `${M}1`);
  assert.strictEqual(N.renderCountDelta(0), '0');
  assert.ok(!N.renderMoneyDelta(-100).includes('-'), 'never an ASCII hyphen');
});

test('magnitudeOf: typed exact decimal, sign and $ , % removed; 8 equals 8.0 but 8.25 is not 8.3', () => {
  assert.deepStrictEqual(N.magnitudeOf('+$4,000'), { type: 'money', value: '4000' });
  assert.deepStrictEqual(N.magnitudeOf(`${M}27%`), { type: 'pct', value: '27' });
  assert.deepStrictEqual(N.magnitudeOf('8.0'), { type: 'count', value: '8' });
  assert.strictEqual(N.magnitudeOf('8').value, N.magnitudeOf('8.0').value);
  assert.notStrictEqual(N.magnitudeOf('8.25').value, N.magnitudeOf('8.3').value);
  assert.strictEqual(N.magnitudeOf('007').value, '7');
});
