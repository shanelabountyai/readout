'use strict';
// The Phase 2 wiring steps in src/steps.js and src/hubspot.js, unit by unit (test/workflow.test.js runs them
// inside workflow.json through the simulator).
const test = require('node:test');
const assert = require('node:assert');
const S = require('../src/steps');
const HS = require('../src/hubspot');
const H = require('./harness');

const page = (ids, next) => ({ results: ids.map((id) => ({ id })), ...(next ? { paging: { next: { after: next } } } : {}) });

test('fromPagedRead: records of the pages kept; truncated when the last page kept still has a next cursor', () => {
  assert.deepStrictEqual(HS.fromPagedRead([page([1, 2], 'a'), page([3])], 20), { records: [{ id: 1 }, { id: 2 }, { id: 3 }], truncated: false });
  assert.deepStrictEqual(HS.fromPagedRead([page([1, 2], 'a'), page([3])], 1), { records: [{ id: 1 }, { id: 2 }], truncated: true });
  assert.strictEqual(HS.fromPagedRead([page([1], 'a'), page([2], 'b')], 20).truncated, true, 'the node stopped at its own Max Pages');
  assert.deepStrictEqual(HS.fromPagedRead([], 20), { records: [], truncated: false });
});

test('sourceFailure: the first failed read in order, or null', () => {
  assert.strictEqual(S.sourceFailure([['a', { values: [] }, 'sheet_error']]), null);
  assert.deepStrictEqual(S.sourceFailure([['a', { values: [] }, 'sheet_error'], ['b', { error: {} }, 'hubspot_error'], ['c', { error: {} }, 'sheet_error']]), { reason: 'hubspot_error', node: 'b' });
});

test('docOutcome: update 2xx keeps the id; update 404 then create is a recreate; failures are drive_error at the node', () => {
  assert.deepStrictEqual(S.docOutcome({ priorDocId: 'D1', updated: { statusCode: 200, body: {} } }), { ok: true, docId: 'D1', action: 'update' });
  assert.deepStrictEqual(S.docOutcome({ priorDocId: 'D1', updated: { statusCode: 404 }, created: { id: 'doc-2' } }), { ok: true, docId: 'doc-2', action: 'recreate' });
  assert.deepStrictEqual(S.docOutcome({ priorDocId: '', created: { id: 'doc-1' } }), { ok: true, docId: 'doc-1', action: 'create' });
  assert.deepStrictEqual(S.docOutcome({ priorDocId: 'D1', updated: { statusCode: 500 } }).failure, { reason: 'drive_error', node: 'Update Doc' });
  assert.deepStrictEqual(S.docOutcome({ priorDocId: '', created: { error: { message: 'x' } } }).failure, { reason: 'drive_error', node: 'Create Doc' });
});

function e01() {
  const r = H.runWeek('E01');
  return { cfg: H.baseCfg, plan: r.plan, computed: r.computed, reviewed: r.reviewed };
}

test('finish: created / updated / 404-gone / prior-gone / skipped draft states; Gmail failures are failed gmail_error', () => {
  const b = e01();
  const f = (mail, extra = {}) => S.finish({ ...b, docId: 'doc-1', mail, modelCalls: 1, ...extra });
  assert.deepStrictEqual(f({ action: 'create', draftId: '' }, { created: { id: 'draft-9' } }).row.slice(2, 8), ['done', '', '', 'doc-1', 'draft-9', 'created']);
  assert.deepStrictEqual(f({ action: 'update', draftId: 'G1' }, { updated: { statusCode: 200 } }).row.slice(5, 8), ['doc-1', 'G1', 'updated']);
  assert.deepStrictEqual(f({ action: 'update', draftId: 'G1' }, { updated: { statusCode: 404 } }).row.slice(5, 8), ['doc-1', 'G1', 'gone']);
  assert.deepStrictEqual(f({ action: 'gone', draftId: 'G1' }).row.slice(5, 8), ['doc-1', 'G1', 'gone']);
  assert.deepStrictEqual(f({ action: 'skip', skip: 'demo_guard_recipient', draftId: '' }).row.slice(3, 8), ['demo_guard_recipient', '', 'doc-1', '', 'skipped']);
  const g = f({ action: 'update', draftId: 'G1' }, { updated: { statusCode: 500 } });
  assert.deepStrictEqual([g.row[2], g.row[3], g.errorRow[2], g.errorRow[3]], ['failed', 'gmail_error', 'Update draft', 'gmail_error']);
  const c = f({ action: 'create', draftId: '' }, { created: { error: { message: '500' } } });
  assert.deepStrictEqual([c.row.slice(2, 8), c.errorRow.slice(2)], [['failed', 'gmail_error', '', 'doc-1', '', ''], ['Create draft', 'gmail_error']]);
});

test('finish: a source failure gives the D-063 row and an errors row; usage reaches the ledger only as integers', () => {
  const b = e01();
  const s = S.finish({ cfg: b.cfg, plan: b.plan, failure: { reason: 'hubspot_error', node: 'Read HubSpot deals' } });
  assert.deepStrictEqual(s.row.slice(2, 11), ['failed', 'hubspot_error', '', '', '', '', '', '', 0]);
  assert.deepStrictEqual(s.errorRow, ['2026-11-23T16:00:00Z', 'run-20261123160000', 'Read HubSpot deals', 'hubspot_error']);
  const u = S.finish({ ...b, docId: 'doc-1', mail: { action: 'create' }, created: { id: 'd-1' }, modelCalls: 1, usage: { input_tokens: 1200, output_tokens: 90 } });
  assert.deepStrictEqual(u.row.slice(10, 13), [1, 1200, 90]);
  const bad = S.finish({ ...b, docId: 'doc-1', mail: { action: 'create' }, created: { id: 'd-1' }, modelCalls: 1, usage: { input_tokens: 'lots', output_tokens: 1.5 } });
  assert.deepStrictEqual(bad.row.slice(11, 13), [0, 0], 'a malformed usage block is not recorded');
});

test('errorRun and errorReasonFor: error-trigger rows from config and the error time; node names cleaned', () => {
  assert.deepStrictEqual(['Read HubSpot tasks', 'Read weekly sheet', 'Append ledger', 'Update Doc', 'Create draft', 'Anthropic', 'Render'].map(S.errorReasonFor),
    ['hubspot_error', 'sheet_error', 'sheet_error', 'drive_error', 'gmail_error', 'model_error', 'unknown_error']);
  const r = S.errorRun({ cfg: H.baseCfg, runAtIso: '2026-11-23T16:00:00Z', node: 'Render<script>' });
  assert.deepStrictEqual(r.errorRow, ['2026-11-23T16:00:00Z', 'run-20261123160000', 'Renderscript', 'unknown_error']);
  assert.deepStrictEqual(r.row.slice(0, 4), ['run-20261123160000', '2026-11-16', 'failed', 'unknown_error']);
});

test('afterLedger: a failed append becomes a sheet_error row; the webhook line is throttled to one per 15 minutes', () => {
  const outcome = S.finish({ cfg: H.baseCfg, plan: e01().plan, failure: { reason: 'sheet_error', node: 'Read ledger' } });
  const cfg = { ...H.baseCfg, alertWebhookUrl: 'https://hooks.example/x' };
  const a = S.afterLedger({ cfg, outcome, appendFailed: false, nowIso: '2026-11-23T16:00:00Z' });
  assert.ok(a.alert && a.lastAlertAt === '2026-11-23T16:00:00Z');
  assert.strictEqual(S.afterLedger({ cfg, outcome, appendFailed: false, lastAlertAt: a.lastAlertAt, nowIso: '2026-11-23T16:14:59Z' }).alert, null);
  assert.ok(S.afterLedger({ cfg, outcome, appendFailed: false, lastAlertAt: a.lastAlertAt, nowIso: '2026-11-23T16:15:00Z' }).alert);
  assert.strictEqual(S.afterLedger({ cfg: H.baseCfg, outcome, appendFailed: false, nowIso: '2026-11-23T16:00:00Z' }).alert, null, 'no URL, no line');
  const ok = { row: outcome.row, errorRow: null };
  assert.deepStrictEqual(S.afterLedger({ cfg: H.baseCfg, outcome: ok, appendFailed: true, nowIso: '2026-11-23T16:00:00Z' }).errorRow.slice(2), ['Append ledger', 'sheet_error']);
  assert.strictEqual(S.afterLedger({ cfg: H.baseCfg, outcome: ok, appendFailed: false, nowIso: '2026-11-23T16:00:00Z' }).errorRow, null);
});

test('draftAction: an update carries the RFC 822 raw message; create, gone and skip carry none', () => {
  const r = H.runWeek('E17');
  const rendered = { headline: r.doc.headline };
  const up = S.draftAction({ cfg: H.baseCfg, plan: r.plan, computed: r.computed, rendered, docId: 'D1' });
  assert.deepStrictEqual([up.action, up.draftId, typeof up.raw], ['update', 'G1', 'string']);
  const c = S.draftAction({ cfg: H.baseCfg, plan: { ...r.plan, prior: { docId: '', draftId: '', draftState: '' } }, computed: r.computed, rendered, docId: 'doc-1' });
  assert.deepStrictEqual([c.action, c.raw], ['create', undefined]);
  assert.strictEqual(S.draftAction({ cfg: H.baseCfg, plan: { ...r.plan, prior: { ...r.plan.prior, draftState: 'gone' } }, computed: r.computed, rendered, docId: 'D1' }).action, 'gone');
});
