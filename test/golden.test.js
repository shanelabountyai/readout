'use strict';
// AC-03 / AC-04 / AC-06 end to end: every PRD §9 golden week through the step harness against its
// hand-typed expected file (fixtures/expected, typed from PRD §9 in fixtures/spec.js; never engine output).
const test = require('node:test');
const assert = require('node:assert');
const FL = require('../src/flags');
const H = require('./harness');
const { WEEKS, TRUNCATED } = require('../fixtures/spec');

for (const w of WEEKS) {
  test(`golden ${w.id} (${w.title}): outcome, reason, model calls, flags, check and every fact rendering`, () => {
    const e = H.loadExpected(w.id);
    const r = H.runWeek(w.id);
    assert.strictEqual(r.outcome, e.outcome, 'outcome');
    assert.strictEqual(r.reason, e.reason, 'reason');
    assert.strictEqual(r.modelCalls, e.modelCalls, 'model calls');
    assert.strictEqual(r.calls.filter((c) => c.api === 'anthropic').length, e.modelCalls, 'model requests made');
    assert.deepStrictEqual(r.flags.map(FL.label), e.flags, 'flags');
    assert.strictEqual(r.ledgerRow[2], e.outcome, 'ledger status');
    assert.strictEqual(r.ledgerRow[3], e.reason, 'ledger reason');
    if (e.check === null) assert.ok(!r.check, 'no narrative was checked');
    else assert.strictEqual(r.check.pass ? 'pass' : r.check.reason, e.check, 'check');
    if (e.facts) assert.deepStrictEqual(Object.fromEntries(r.facts.map((f) => [f.id, f.rendering])), e.facts, 'facts');
    if (e.flagSentences) for (const [code, s] of Object.entries(e.flagSentences)) assert.strictEqual(r.flags.find((f) => f.code === code).sentence, s);
    if (e.stalled) assert.deepStrictEqual(r.computed.snapshot.stalled, e.stalled);
    if (e.docId) assert.deepStrictEqual([r.doc.id, r.doc.action, r.draft.id, r.draft.action], [e.docId, e.docAction, e.draftId, e.draftAction]);
    if (e.draftState) assert.strictEqual(r.draftState, e.draftState);
    if (e.ledgerRowsForWeek) assert.strictEqual(r.ledgerAfter.slice(1).filter((x) => x[1] === '2026-11-16').length, e.ledgerRowsForWeek);
    if (e.dataNote) assert.ok(r.docHtml.includes(e.dataNote));
    if (e.outcome === 'done') assert.ok(r.reviewed.narrative, 'a passing narrative is used');
    if (e.outcome === 'metrics_only') assert.strictEqual(r.reviewed.narrative, null, 'no model text on a metrics-only page');
  });
}

test('AC-05 golden E01-truncated: hubspot_truncated with its Data note; the narrative still passes', () => {
  const e = H.loadExpected(TRUNCATED.id);
  const r = H.runWeek(TRUNCATED.id);
  for (const code of e.flagsInclude) assert.ok(r.flags.some((f) => f.code === code), code);
  assert.ok(r.docHtml.includes(e.dataNote));
  assert.deepStrictEqual([r.outcome, r.reason, r.modelCalls, r.check.pass], [e.outcome, e.reason, e.modelCalls, true]);
});

test('AC-15 shape in Phase 1 (E20): HubSpot failure → no model call, no Doc, no draft, an errors row, status failed', () => {
  const r = H.runWeek('E20');
  assert.deepStrictEqual([r.outcome, r.reason, r.modelCalls, r.doc, r.draft], ['failed', 'hubspot_error', 0, null, null]);
  assert.ok(!r.calls.some((c) => ['anthropic', 'drive', 'gmail'].includes(c.api)));
  assert.deepStrictEqual(r.errorRow, ['2026-11-23T16:00:00Z', 'run-20261123160000', 'Read HubSpot deals', 'hubspot_error']);
  assert.deepStrictEqual(r.ledgerRow.slice(2, 8), ['failed', 'hubspot_error', '', '', '', '']);
});

test('AC-06: a non-quiet run makes exactly one model call; quiet, capped and failed runs make none', () => {
  const calls = (id, o) => H.runWeek(id, o).calls.filter((c) => c.api === 'anthropic').length;
  for (const id of ['E01', 'E03', 'E05', 'E09', 'E14', 'E17', 'E19']) assert.strictEqual(calls(id), 1, id);
  assert.strictEqual(calls('E02'), 0);
  assert.strictEqual(calls('E16'), 0);
  assert.strictEqual(calls('E20'), 0);
  assert.strictEqual(calls('E01', { cfg: { perRunTokenCeiling: 1 } }), 0);
});

test('a model error is a metrics-only page with reason model_error (no retry, D-012)', () => {
  const r = H.runWeek('E01', { modelError: true });
  assert.deepStrictEqual([r.outcome, r.reason, r.modelCalls], ['metrics_only', 'model_error', 1]);
  assert.ok(r.docHtml.includes('Narrative withheld: the model could not be reached.'));
});

test('PRD §9 tally: 7 model passes, 1 quiet, 9 rejections over 6 reasons, 1 cap, 1 re-run, 1 failure', () => {
  const e = Object.fromEntries(WEEKS.map((w) => [w.id, H.loadExpected(w.id)]));
  const passes = WEEKS.filter((w) => e[w.id].outcome === 'done' && e[w.id].modelCalls === 1 && w.id !== 'E17').map((w) => w.id);
  assert.deepStrictEqual(passes, ['E01', 'E03', 'E08', 'E10', 'E12', 'E18', 'E19']);
  const rejections = WEEKS.filter((w) => e[w.id].outcome === 'metrics_only' && e[w.id].modelCalls === 1);
  assert.strictEqual(rejections.length, 9);
  assert.strictEqual(new Set(rejections.map((w) => e[w.id].reason)).size, 6);
});
