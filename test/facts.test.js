'use strict';
const test = require('node:test');
const assert = require('node:assert');
const H = require('./harness');
const { E01_FACTS } = require('../fixtures/spec');

const table = (r) => Object.fromEntries(r.facts.map((f) => [f.id, f.rendering]));

test('E01: 56 history facts and 3 snapshot facts match the PRD §9 E01 table exactly', () => {
  const r = H.runWeek('E01');
  assert.strictEqual(r.facts.filter((f) => !['open_pipeline', 'stalled_deals', 'overdue_tasks'].includes(f.metric)).length, 56);
  assert.strictEqual(r.facts.length, 59);
  assert.deepStrictEqual(table(r), E01_FACTS);
  assert.ok(!r.facts.some((f) => f.field === 'sum4'), 'sum4 is never a fact');
});

test('E03: no revenue.cur / wow / avg facts, but revenue.prev $42,000 and revenue.avg4 $41,000 remain', () => {
  const t = table(H.runWeek('E03'));
  for (const id of ['revenue.cur', 'revenue.wow_abs', 'revenue.wow_pct', 'revenue.avg_abs', 'revenue.avg_pct']) assert.ok(!(id in t), id);
  assert.strictEqual(t['revenue.prev'], '$42,000');
  assert.strictEqual(t['revenue.avg4'], '$41,000');
});

test('E15: no deals_won.wow_pct; E08: stalled.1.idle_days is 11', () => {
  assert.ok(!('deals_won.wow_pct' in table(H.runWeek('E15'))));
  assert.strictEqual(table(H.runWeek('E08'))['stalled.1.idle_days'], '11');
});

test('a fact\'s sign is the sign of its exact value (E02 cash +$500 renders 0% with sign +1); isDelta on the four delta fields', () => {
  const r = H.runWeek('E02');
  const f = new Map(r.facts.map((x) => [x.id, x]));
  for (const [id, sign] of Object.entries(H.loadExpected('E02').signs)) assert.strictEqual(f.get(id).sign, sign, id);
  assert.strictEqual(f.get('cash.wow_pct').rendering, '0%');
  assert.deepStrictEqual(r.facts.filter((x) => x.isDelta).map((x) => x.field).filter((v, i, a) => a.indexOf(v) === i).sort(), ['avg_abs', 'avg_pct', 'wow_abs', 'wow_pct']);
  assert.ok(r.facts.every((x) => ['count', 'money', 'pct'].includes(x.type)));
  assert.strictEqual(f.get('won_amount.wow_pct').type, 'pct');
});
