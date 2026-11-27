'use strict';
// AC-13
const test = require('node:test');
const assert = require('node:assert');
const S = require('../src/spend');
const H = require('./harness');

const cfg = H.baseCfg;

test('AC-13 (E16): with weeklyCallCap reached, no model call and a metrics_only page with reason weekly_cap', () => {
  const r = H.runWeek('E16');
  assert.strictEqual(r.modelCalls, 0);
  assert.ok(!r.calls.some((c) => c.api === 'anthropic'));
  assert.deepStrictEqual([r.outcome, r.reason, r.ledgerRow[2], r.ledgerRow[3]], ['metrics_only', 'weekly_cap', 'metrics_only', 'weekly_cap']);
  assert.deepStrictEqual([r.doc.id, r.doc.action, r.draft.id, r.draft.action], ['D1', 'update', 'G1', 'update']);
});

test('AC-13: token ceiling — a built prompt over perRunTokenCeiling makes no call (token_ceiling)', () => {
  const r = H.runWeek('E01', { cfg: { perRunTokenCeiling: 100 } });
  assert.deepStrictEqual([r.outcome, r.reason, r.modelCalls], ['metrics_only', 'token_ceiling', 0]);
  assert.deepStrictEqual(S.gate({ callsThisWeek: 0, estimatedInputTokens: 20001, spentThisWeekUsd: 0, cfg }), { allowed: false, reason: 'token_ceiling' });
  assert.deepStrictEqual(S.gate({ callsThisWeek: 0, estimatedInputTokens: 20000, spentThisWeekUsd: 0, cfg }), { allowed: true, reason: '' });
});

test('AC-13: the dollar cap is ignored while prices are null and enforced once they are set', () => {
  assert.strictEqual(S.precheck({ callsThisWeek: 0, spentThisWeekUsd: 5, cfg }).allowed, true);
  const priced = { ...cfg, priceInputPerMTokUsd: 3, priceOutputPerMTokUsd: 15 };
  assert.deepStrictEqual(S.precheck({ callsThisWeek: 0, spentThisWeekUsd: 1.0, cfg: priced }), { allowed: false, reason: 'spend_cap' });
  assert.strictEqual(S.precheck({ callsThisWeek: 0, spentThisWeekUsd: 0.99, cfg: priced }).allowed, true);
  const ledger = [...H.loadWeek('E01').ledger, ['run-x', '2026-11-16', 'done', '', '', 'D1', 'G1', 'created', 'narrate-v0.1', 'claude-sonnet-5-5', '1', '1', '1', '1.000000', '1', '2026-11-23T07:00:00Z']];
  const r = H.runWeek('E01', { cfg: priced, ledger });
  assert.deepStrictEqual([r.outcome, r.reason, r.modelCalls], ['metrics_only', 'spend_cap', 0]);
});

test('costUsd is null while prices are null; computed from usage once set; written with six decimals', () => {
  assert.strictEqual(S.costUsd({ input_tokens: 1000, output_tokens: 100 }, cfg), null);
  assert.strictEqual(S.costUsd({ input_tokens: 1000000, output_tokens: 0 }, { ...cfg, priceInputPerMTokUsd: 3, priceOutputPerMTokUsd: 15 }), 3);
  const r = H.runWeek('E01', { cfg: { priceInputPerMTokUsd: 3, priceOutputPerMTokUsd: 15 } });
  assert.match(r.ledgerRow[13], /^\d+\.\d{6}$/);
  assert.strictEqual(H.runWeek('E01').ledgerRow[13], '');
});
