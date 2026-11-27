'use strict';
const test = require('node:test');
const assert = require('node:assert');
const T = require('../src/template');
const C = require('../src/checks');
const L = require('../src/ledger');
const H = require('./harness');

test('E02: the quiet-week template passes the checks; headline fixed and digit-free; no direction word', () => {
  const r = H.runWeek('E02');
  assert.strictEqual(r.reviewed.source, 'template');
  assert.ok(r.reviewed.check.pass);
  assert.strictEqual(r.reviewed.narrative.headline.text, 'Quiet week in the CRM');
  assert.doesNotMatch(r.reviewed.narrative.headline.text, /\d/);
  const text = r.reviewed.narrative.paragraphs[0].text;
  for (const w of [...C.RISE_WORDS, ...C.FALL_WORDS]) assert.doesNotMatch(text, new RegExp(`\\b${w}\\b`, 'i'), w);
  assert.match(text, /1 new contact was added/);
});

test('the template passes its own check when revenue or cash is missing, and with zero contacts', () => {
  const facts = H.runWeek('E02').facts.filter((f) => !f.id.startsWith('revenue.') && !f.id.startsWith('cash.'));
  assert.ok(C.check(T.quietNarrative(facts), facts).pass);
  const zero = facts.map((f) => (f.id === 'new_contacts.cur' ? { ...f, rendering: '0', sign: 0 } : f));
  assert.ok(C.check(T.quietNarrative(zero), zero).pass);
});

test('every reason in the ledger\'s closed set has plain words (no codes shown to the owner)', () => {
  for (const r of L.REASONS.filter(Boolean)) {
    assert.ok(T.REASON_WORDS[r], r);
    assert.doesNotMatch(T.REASON_WORDS[r], /_/, r);
  }
  assert.strictEqual(T.REASON_WORDS.number_not_in_metrics, 'the draft quoted a number the data does not contain');
});

test('code headline: "Weekly pulse: Mon 16 Nov – Sun 22 Nov 2026"', () => {
  assert.strictEqual(T.codeHeadline('2026-11-16'), 'Weekly pulse: Mon 16 Nov – Sun 22 Nov 2026');
});
