'use strict';
// AC-14 (recipient guard), PRD §7 draft
const test = require('node:test');
const assert = require('node:assert');
const E = require('../src/email');
const H = require('./harness');

test('subject, owner-only recipient, five code-built lines, headline and Doc link', () => {
  const r = H.runWeek('E01');
  assert.strictEqual(r.draft.to, 'owner@tallgrassadvisory.example');
  assert.strictEqual(r.draft.subject, 'Weekly pulse: week of 2026-11-16');
  const lines = r.draft.body.split('\n');
  assert.strictEqual(lines[0], 'The week in numbers');
  assert.deepStrictEqual(lines.slice(2, 7), [
    'Revenue (as entered): $46,000 (+$4,000 vs last week)',
    'Cash at week end: $123,000 (+$4,000 vs last week)',
    'Deals won: 2 for $18,000 (won value, CRM)',
    'New contacts: 9',
    'Watch: nothing flagged',
  ]);
  assert.strictEqual(lines[8], 'The page: https://docs.google.com/document/d/doc-1/edit');
  assert.deepStrictEqual(Object.keys(r.draft).filter((k) => ['cc', 'bcc'].includes(k)), []);
});

test('AC-14: a non-.example owner in demo mode means no draft (demo_guard_recipient); outside demo mode it is allowed', () => {
  const r = H.runWeek('E01', { cfg: { ownerEmail: 'shane@realfirm.com' } });
  assert.strictEqual(r.draft, null);
  assert.strictEqual(r.draftState, 'skipped');
  assert.strictEqual(r.reason, 'demo_guard_recipient');
  assert.ok(!r.calls.some((c) => c.api === 'gmail'));
  assert.ok(E.build({ cfg: { ...H.baseCfg, demoMode: false, ownerEmail: 'shane@realfirm.com' }, weekStart: '2026-11-16', facts: r.facts, flags: [], headline: 'h', docLink: 'x' }).to);
});

test('no model string other than the checked headline: a withheld week (E13) uses the code headline', () => {
  const r = H.runWeek('E13');
  assert.strictEqual(r.draft.body.split('\n')[0], 'Weekly pulse: Mon 16 Nov – Sun 22 Nov 2026');
  assert.ok(!r.draft.body.includes('year-end'));
  assert.ok(!r.draft.body.includes('The week in numbers'));
  const e03 = H.runWeek('E03').draft.body;
  assert.match(e03, /Revenue \(as entered\): not entered/);
});
