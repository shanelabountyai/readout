'use strict';
// AC-11 (idempotent per week), AC-12 (no business data)
const test = require('node:test');
const assert = require('node:assert');
const L = require('../src/ledger');
const H = require('./harness');

const ok = () => ({ run_id: 'run-20261123160000', week_start: '2026-11-16', status: 'done', reason: '', flags: 'stalled_deals|overdue_tasks', doc_id: 'D1', draft_id: 'r-123', draft_state: 'created', prompt_version: 'narrate-v0.1', model: 'claude-sonnet-5-5', model_calls: 1, input_tokens: 3000, output_tokens: 200, cost_usd: '', runtime_s: 12, run_at: '2026-11-23T16:00:00Z' });

test('AC-12: a valid row is the 16 columns in order', () => {
  assert.strictEqual(L.buildRow(ok()).length, 16);
  assert.deepStrictEqual(L.COLUMNS.slice(0, 3), ['run_id', 'week_start', 'status']);
});

test('AC-12: refuses a dollar amount in reason, a name in doc_id, an unknown column, a missing column and other business data', () => {
  const bad = {
    'dollar amount in reason': { reason: '$46,000' },
    'name in doc_id': { doc_id: '[demo] Bluewater fleet reporting' },
    'bare word in doc_id': { doc_id: 'Bluewater' },
    'name as run_id': { run_id: 'Smith' },
    'email in draft_id': { draft_id: 'owner@tallgrassadvisory.example' },
    'unknown flag code': { flags: 'stalled_deals|Bluewater' },
    'free text status': { status: 'great week' },
    'amount as tokens': { input_tokens: '46,000' },
    'fractional calls': { model_calls: 1.5 },
    'cost with text': { cost_usd: '$0.01' },
    'local timestamp': { run_at: '2026-11-23 10:00' },
    'bad week': { week_start: 'week of Nov 16' },
  };
  for (const [name, patch] of Object.entries(bad)) assert.throws(() => L.buildRow({ ...ok(), ...patch }), /refused/, name);
  assert.throws(() => L.buildRow({ ...ok(), revenue: 4600000 }), /unknown column/);
  const missing = ok(); delete missing.model;
  assert.throws(() => L.buildRow(missing), /missing column/);
});

test('every row the golden weeks write passes buildRow (it is built by it) and holds no amount, name or email', () => {
  for (const id of ['E01', 'E02', 'E08', 'E09', 'E16', 'E18', 'E20']) {
    const row = H.runWeek(id).ledgerRow.join(' ');
    assert.doesNotMatch(row, /\$|@|Bluewater|demo\]/, id);
  }
});

test('AC-11 (E17): the re-run updates Doc D1 and draft G1 by id, makes no create call, and the week then has 2 rows', () => {
  const r = H.runWeek('E17');
  assert.deepStrictEqual([r.doc.id, r.doc.action, r.draft.id, r.draft.action, r.draftState], ['D1', 'update', 'G1', 'update', 'updated']);
  assert.ok(!r.calls.some((c) => (c.api === 'drive' || c.api === 'gmail') && c.method === 'POST'));
  assert.strictEqual(L.records(r.ledgerAfter).filter((x) => x.week_start === '2026-11-16').length, 2);
});

test('D-045: done, then failed (empty ids), then a re-run → the same Doc and draft ids', () => {
  const first = H.runWeek('E01');
  const failed = H.runWeek('E20', { ledger: first.ledgerAfter });
  assert.strictEqual(failed.ledgerRow[5], '');
  const again = H.runWeek('E01', { ledger: failed.ledgerAfter, runAt: '2026-11-23T18:00:00Z' });
  assert.deepStrictEqual([again.doc.id, again.doc.action, again.draft.id, again.draft.action], ['doc-1', 'update', 'draft-1', 'update']);
});

test('E20 then a re-run: no Doc id is found, so the re-run creates one', () => {
  const failed = H.runWeek('E20');
  const again = H.runWeek('E01', { ledger: failed.ledgerAfter });
  assert.strictEqual(again.doc.action, 'create');
});

test('draft_state gone is remembered: no draft call and the new row says gone', () => {
  const first = H.runWeek('E17', { goneDrafts: ['G1'] });
  assert.strictEqual(first.draftState, 'gone');
  const again = H.runWeek('E01', { ledger: first.ledgerAfter, runAt: '2026-11-23T18:00:00Z' });
  assert.strictEqual(again.draftState, 'gone');
  assert.ok(!again.calls.some((c) => c.api === 'gmail'));
  assert.strictEqual(again.ledgerRow[7], 'gone');
});

test('append-only: appendCall is an INSERT_ROWS append; callsInCalendarWeek counts only the run\'s calendar week', () => {
  const c = L.appendCall(H.baseCfg, L.buildRow(ok()));
  assert.strictEqual(c.method, 'POST');
  assert.match(c.url, /:append\?valueInputOption=RAW&insertDataOption=INSERT_ROWS$/);
  const recs = L.records(H.loadWeek('E16').ledger);
  assert.strictEqual(L.callsInCalendarWeek(recs, '2026-11-23T06:00:00Z', '2026-11-30T06:00:00Z'), 3);
  assert.strictEqual(L.callsInCalendarWeek(recs, '2026-11-16T06:00:00Z', '2026-11-23T06:00:00Z'), 0);
});
