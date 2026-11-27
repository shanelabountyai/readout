'use strict';
// AC-07: every check reason has a golden week or a recorded variant that triggers it, and only it, first.
const test = require('node:test');
const assert = require('node:assert');
const C = require('../src/checks');
const H = require('./harness');
const { WEEKS, VARIANTS } = require('../fixtures/spec');

const E01 = H.runWeek('E01');
const E08 = H.runWeek('E08');
const chk = (narr, base = E01) => C.check(narr, base.facts, base.computed.stalledNames);
const one = (text, cites = [], suggestions = []) => ({ headline: { text: 'The week in numbers', cites: [] }, paragraphs: [{ text, cites }], suggestions });

test('golden-week narratives give their PRD §9 check result (E01, E03–E15, E17–E19)', () => {
  let n = 0;
  for (const w of WEEKS.filter((x) => x.recorded)) {
    const r = H.runWeek(w.id);
    const c = C.check(w.recorded, r.facts, r.computed.stalledNames);
    assert.strictEqual(c.pass ? 'pass' : c.reason, w.expected.check, w.id);
    n++;
  }
  assert.strictEqual(n, 17);
});

test('AC-07: one recorded variant per remaining reason, each the first failure', () => {
  for (const v of VARIANTS) {
    const s = H.loadVariant(v.id);
    const c = chk(s.input);
    assert.strictEqual(c.reason, v.reason, v.id);
    assert.strictEqual(s.expectedReason, v.reason);
  }
  const covered = new Set([...WEEKS.map((w) => w.expected.check), ...VARIANTS.map((v) => v.reason)]);
  for (const r of C.REASONS) assert.ok(covered.has(r), `no fixture triggers ${r}`);
});

test('precedence: a paragraph with a missing cite and a stray number reports cited_fact_missing (all failures kept)', () => {
  const c = chk(one('Revenue was $99,999.', ['revenue.nope']));
  assert.strictEqual(c.reason, 'cited_fact_missing');
  assert.deepStrictEqual(c.failures.map((f) => f.reason), ['cited_fact_missing', 'number_not_in_metrics']);
});

test('direction: explicit + on a negative fact fails; − on a positive fact fails; a matching sign passes', () => {
  const e09 = H.runWeek('E09');
  assert.strictEqual(chk(one('Revenue was +$12,000 against last week.', ['revenue.wow_abs']), e09).reason, 'direction_mismatch');
  assert.strictEqual(chk(one('Revenue moved −$4,000 on last week.', ['revenue.wow_abs'])).reason, 'direction_mismatch');
  assert.ok(chk(one('Revenue moved +$4,000 on last week.', ['revenue.wow_abs'])).pass);
  assert.ok(chk(one('Revenue moved −$12,000 on last week.', ['revenue.wow_abs']), e09).pass);
});

test('direction: a rise word next to a zero-valued cited delta fails; a sentence with both kinds of word is not judged', () => {
  assert.strictEqual(chk(one('Deals lost were up 0% on the average.', ['deals_lost.avg_pct'])).reason, 'direction_mismatch');
  assert.ok(chk(one('Revenue was up and cash was down by $4,000 each.', ['revenue.wow_abs', 'cash.wow_abs'])).pass);
});

test('direction: one contradicting cited fact is enough (any, not all)', () => {
  // $4,000 matches revenue.wow_abs (+) and, in E10, cash.wow_abs is −$14,000: build a case where one matched cite is negative
  const e10 = H.runWeek('E10');
  const c = chk(one('Cash and revenue both rose 12% this week.', ['cash.wow_pct', 'revenue.avg_pct']), e10);
  assert.strictEqual(c.reason, 'direction_mismatch');
});

test('known false trigger, pinned: "followed up" contains "up" and fails safe (PRD §6 Known limits)', () => {
  const c = chk(one('The team followed up on 1 deal lost, down from last week.', ['deals_lost.cur', 'deals_lost.wow_abs']));
  assert.ok(C.RISE_WORDS.includes('up'));
  assert.strictEqual(c.reason, '', 'mixed rise/fall words: not judged');
  const d = chk(one('The team followed up after deals lost fell to 1.', ['deals_lost.cur']));
  assert.ok(d.pass, 'both words present → not judged; documents that the scan is word-based');
  const e = chk(one('Deals lost were 1 and we followed up, a change of −1.', ['deals_lost.cur', 'deals_lost.wow_abs']));
  assert.strictEqual(e.reason, 'direction_mismatch', '"followed up" alone makes a rise sentence against a negative delta');
});

test('stripping: 4-week, four-week, week-over-week, ISO dates and stalled names (with or without [demo]) are removed before scanning', () => {
  assert.ok(chk(one('Revenue was $46,000 against a 4-week average of $41,000 for the week of 2026-11-16.', ['revenue.cur', 'revenue.avg4'])).pass);
  assert.ok(chk(one('Week-over-week, revenue was $46,000.', ['revenue.cur'])).pass);
  assert.ok(chk(one('[demo] Bluewater fleet reporting has stalled at 11 days.', ['stalled.1.idle_days']), E08).pass);
  assert.strictEqual(C.strip('Bluewater fleet reporting', ['[demo] Bluewater fleet reporting']).trim(), '');
});

test('token typing: 8 matches 8.0; $ makes money and % a percentage; a count never matches money', () => {
  assert.ok(chk(one('New contacts were 9 against an average of 8.', ['new_contacts.cur', 'new_contacts.avg4'])).pass);
  assert.strictEqual(chk(one('Won value was 18,000.', ['won_amount.cur'])).reason, 'number_not_in_metrics');
  assert.strictEqual(chk(one('Revenue rose 4,000%.', ['revenue.wow_abs'])).reason, 'number_not_in_metrics');
  assert.deepStrictEqual(C.tokens('a $46,000 b +13% c −1 d 8.3.').map((t) => [t.type, t.value, t.sign]), [['money', '46000', 0], ['pct', '13', 1], ['count', '1', -1], ['count', '8.3', 0]]);
});

test('too_long: 15-word headline passes, 16 fails; 180 words in total; 30-word suggestion', () => {
  const w = (n) => Array(n).fill('word').join(' ');
  assert.ok(chk({ headline: { text: w(15), cites: [] }, paragraphs: [{ text: w(165), cites: [] }], suggestions: [{ text: w(30) }] }).pass);
  assert.strictEqual(chk({ headline: { text: w(16), cites: [] }, paragraphs: [{ text: 'ok', cites: [] }], suggestions: [] }).reason, 'too_long');
  assert.strictEqual(chk({ headline: { text: w(15), cites: [] }, paragraphs: [{ text: w(166), cites: [] }], suggestions: [] }).reason, 'too_long');
  assert.strictEqual(chk({ headline: { text: 'ok', cites: [] }, paragraphs: [{ text: 'ok', cites: [] }], suggestions: [{ text: w(31) }] }).reason, 'too_long');
});

test('word lists are whole words, case-insensitive; "one" and "none" allowed; suggestions scanned for causes and spelled numbers', () => {
  assert.ok(chk(one('One deal was lost and none were moved twice-over.', [])).reason !== 'spelled_number');
  assert.strictEqual(chk(one('Twelve contacts arrived.', [])).reason, 'spelled_number');
  assert.ok(chk(one('Revenue was $46,000, a recordable figure.', ['revenue.cur'])).pass, '"recordable" is not "record"');
  assert.strictEqual(chk(one('Revenue was $46,000, a RECORD.', ['revenue.cur'])).reason, 'unverifiable_claim');
  assert.strictEqual(chk(one('Fine.', [], [{ text: 'Call them because the deal is quiet.' }])).reason, 'causal_claim');
  assert.strictEqual(chk(one('Fine.', [], [{ text: 'Call three of them.' }])).reason, 'spelled_number');
  assert.ok(chk(one('Fine.', [], [{ text: 'Consider calling the Bluewater contact.' }])).pass, 'advice is allowed in a suggestion');
  assert.strictEqual(chk(one('Revenue was $46,000; focus on renewals.', ['revenue.cur'])).reason, 'advice_in_facts');
});

test('D-066: hyphen-joined words are whole words for spelled, unverifiable, advice and causal lists; phrases span whitespace', () => {
  assert.strictEqual(chk(one('Revenue rose twenty-five percent on last week.', [])).reason, 'spelled_number');
  assert.strictEqual(chk(one('Revenue was $46,000, a record-high.', ['revenue.cur'])).reason, 'unverifiable_claim');
  assert.strictEqual(chk(one('This is a must-win renewal.', [])).reason, 'advice_in_facts');
  assert.strictEqual(chk(one('Revenue moved due\nto billing.', [])).reason, 'causal_claim');
  assert.strictEqual(chk(one('We need   to call.', [])).reason, 'advice_in_facts');
  assert.ok(chk(one('A follow-up was booked for 1 deal lost, down from last week.', ['deals_lost.cur'])).pass, 'direction words keep the hyphen guard');
});

test('too_long, not schema, for a long paragraph (character caps sit far above the word limits)', () => {
  const c = chk(one(Array(300).fill('word').join(' '), []));
  assert.strictEqual(c.reason, 'too_long');
});

test('number_in_suggestion scans the stripped text: a 4-week mention or a stalled name with a digit is not a number', () => {
  assert.ok(chk(one('Fine.', [], [{ text: 'Review the four-week trend with the team.' }])).pass);
  const facts = E01.facts;
  assert.ok(C.check(one('Fine.', [], [{ text: 'Call the Route 9 Logistics contact.' }]), facts, ['[demo] Route 9 Logistics']).pass);
});

test('D-055: links and placeholders fail in any part; a stalled [demo] name is not a placeholder', () => {
  assert.strictEqual(chk(one('Fine.', [], [{ text: 'See www.tallgrass.example for detail.' }])).reason, 'link');
  assert.strictEqual(chk(one('Revenue was $46,000 for {{client}}.', ['revenue.cur'])).reason, 'placeholder');
  assert.strictEqual(chk(one('TBD.', [])).reason, 'placeholder');
  assert.ok(chk(one('[demo] Bluewater fleet reporting is idle 11 days.', ['stalled.1.idle_days']), E08).pass);
});

test('schema failure is reason schema and stops there', () => {
  assert.strictEqual(chk({ headline: { text: 'x', cites: [] }, paragraphs: [] , suggestions: [] }).reason, 'schema');
  assert.strictEqual(chk(null).reason, 'schema');
});
