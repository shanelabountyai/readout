'use strict';
// AC-03 (metrics)
const test = require('node:test');
const assert = require('node:assert');
const Mx = require('../src/metrics');
const HS = require('../src/hubspot');
const W = require('../src/week');
const H = require('./harness');

const cfg = H.baseCfg;
const window = W.reportWeek('2026-11-23T16:00:00Z', 'America/Chicago').window;
const run = (deals, contacts = [], tasks = []) => Mx.compute({ deals: deals.map(HS.normaliseDeal), contacts, tasks }, window, cfg, H.RULES);
const d = (id, stage, history, props = {}) => ({ id, properties: { dealname: `[demo] D${id}`, dealstage: stage, pipeline: 'default', amount: '1000', createdate: history[0][1], ...props }, propertiesWithHistory: { dealstage: history.map(([value, timestamp]) => ({ value, timestamp })) } });
const REPORT = '2026-11-18T15:00:00.000Z';

test('AC-03: E01 series from the fixture match the PRD §9 baseline and E01 week', () => {
  const r = H.runWeek('E01');
  const e = H.loadExpected('E01');
  for (const [k, v] of Object.entries(e.series)) assert.deepStrictEqual(r.computed.series[k], v, k);
  assert.strictEqual(r.computed.snapshot.open_pipeline, 21000000);
  assert.strictEqual(r.computed.snapshot.overdue_tasks, 2);
  assert.deepStrictEqual(r.computed.snapshot.stalled, []);
});

test('a deal created and moved in the same week counts once in each', () => {
  const m = run([d('1', 'qualifiedtobuy', [['appointmentscheduled', '2026-11-17T15:00:00.000Z'], ['qualifiedtobuy', REPORT], ['presentationscheduled', '2026-11-19T15:00:00.000Z'], ['qualifiedtobuy', '2026-11-20T15:00:00.000Z']])]);
  assert.strictEqual(m.series.deals_created[4], 1);
  assert.strictEqual(m.series.deals_moved[4], 1);
});

test('D-022: a move into closedwon is not a move; the first (creation) entry is not a move', () => {
  const m = run([d('1', 'closedwon', [['appointmentscheduled', '2026-09-01T15:00:00.000Z'], ['closedwon', REPORT]], { closedate: REPORT }), d('2', 'appointmentscheduled', [['appointmentscheduled', REPORT]])]);
  assert.strictEqual(m.series.deals_moved[4], 0);
  assert.strictEqual(m.series.deals_won[4], 1);
  assert.strictEqual(m.series.won_amount[4], 100000);
});

test('D-042: a repeated same-stage history entry is not a move', () => {
  const m = run([d('1', 'qualifiedtobuy', [['appointmentscheduled', '2026-09-01T15:00:00.000Z'], ['qualifiedtobuy', '2026-09-15T15:00:00.000Z'], ['qualifiedtobuy', REPORT]], { notes_last_updated: REPORT })]);
  assert.strictEqual(m.series.deals_moved[4], 0);
});

test('D-041: a stage entry newer than notes_last_updated resets idle', () => {
  const stale = d('1', 'contractsent', [['appointmentscheduled', '2026-09-01T15:00:00.000Z'], ['contractsent', '2026-09-15T15:00:00.000Z']], { notes_last_updated: '2026-10-01T15:00:00.000Z' });
  const fresh = d('2', 'contractsent', [['appointmentscheduled', '2026-09-01T15:00:00.000Z'], ['contractsent', '2026-11-20T15:00:00.000Z']], { notes_last_updated: '2026-10-01T15:00:00.000Z' });
  const m = run([stale, fresh]);
  assert.deepStrictEqual(m.snapshot.stalled.map((s) => s.name), ['[demo] D1']);
});

test('D-015: E08 boundary — Bluewater idle 11 > 10 is stalled, Harborview idle exactly 21 is not', () => {
  const r = H.runWeek('E08');
  assert.deepStrictEqual(r.computed.snapshot.stalled, [{ name: '[demo] Bluewater fleet reporting', stage: 'contractsent', idleDays: 11 }]);
});

test('D-033, D-049: overdue counts every status except COMPLETED, due before the week end; due at the end is not overdue', () => {
  const t = (id, status, dueAt) => ({ id, status, dueAt });
  const m = run([], [], [t('1', 'NOT_STARTED', REPORT), t('2', 'IN_PROGRESS', REPORT), t('3', 'WAITING', REPORT), t('4', 'DEFERRED', REPORT), t('5', 'COMPLETED', REPORT), t('6', 'NOT_STARTED', '2026-11-23T06:00:00.000Z'), t('7', 'NOT_STARTED', null)]);
  assert.strictEqual(m.snapshot.overdue_tasks, 4);
});

test('missing amounts are counted, not named (D-039); an unknown open stage is never stalled and is named once', () => {
  const m = run([
    d('1', 'closedwon', [['appointmentscheduled', '2026-09-01T15:00:00.000Z'], ['closedwon', REPORT]], { closedate: REPORT, amount: '' }),
    d('2', 'qualifiedtobuy', [['qualifiedtobuy', '2026-11-20T15:00:00.000Z']], { amount: null }),
    d('3', 'customstage', [['customstage', '2026-01-01T15:00:00.000Z']]),
  ]);
  assert.deepStrictEqual(m.notes, { wonMissingAmount: 1, openMissingAmount: 1, unknownStages: ['customstage'] });
  assert.strictEqual(m.series.won_amount[4], 0);
  assert.strictEqual(m.snapshot.stalled.length, 0);
});
