'use strict';
// AC-14 (demo guard), normalisation
const test = require('node:test');
const assert = require('node:assert');
const HS = require('../src/hubspot');
const H = require('./harness');

const cfg = H.baseCfg;
const deal = (id, name, props = {}, history = []) => ({ id, properties: { dealname: name, dealstage: 'qualifiedtobuy', pipeline: 'default', amount: '1000', createdate: '2026-11-17T15:00:00.000Z', ...props }, propertiesWithHistory: { dealstage: history } });

test('AC-14: the demo guard excludes a non-[demo] deal, a .test contact, a contact with no email and a non-[demo] task, and counts them', () => {
  const n = HS.normalise({
    deals: [deal('1', '[demo] Kept'), deal('2', 'Real customer renewal')],
    contacts: [{ id: 'c1', properties: { email: 'a@firm.example', createdate: '2026-11-17T15:00:00Z' } }, { id: 'c2', properties: { email: 'lead@newprospect.test', createdate: '2026-11-17T15:00:00Z' } }, { id: 'c3', properties: { createdate: '2026-11-17T15:00:00Z' } }],
    tasks: [{ id: 't1', properties: { hs_task_subject: '[demo] Call', hs_task_status: 'NOT_STARTED', hs_timestamp: '2026-11-18T15:00:00Z' } }, { id: 't2', properties: { hs_task_subject: 'Call a real person', hs_task_status: 'NOT_STARTED' } }],
  }, cfg);
  assert.deepStrictEqual(n.deals.map((d) => d.id), ['1']);
  assert.deepStrictEqual(n.contacts.map((c) => c.id), ['c1']);
  assert.deepStrictEqual(n.tasks.map((t) => t.id), ['t1']);
  assert.deepStrictEqual(n.skipped, { deals: 1, contacts: 2, tasks: 1 });
});

test('D-032: contact emails and task subjects do not survive normalisation', () => {
  const n = HS.normalise({ contacts: [{ id: 'c1', properties: { email: 'a@firm.example', createdate: '2026-11-17T15:00:00Z' } }], tasks: [{ id: 't1', properties: { hs_task_subject: '[demo] Call Jo', hs_task_status: 'NOT_STARTED' } }] }, cfg);
  assert.doesNotMatch(JSON.stringify({ c: n.contacts, t: n.tasks }), /@|Call Jo/);
});

test('D-040: a deal in another pipeline is dropped and not counted as skipped', () => {
  const n = HS.normalise({ deals: [deal('1', '[demo] Other', { pipeline: 'renewals' })] }, cfg);
  assert.strictEqual(n.deals.length, 0);
  assert.strictEqual(n.skipped.deals, 0);
});

test('stage history sorted oldest first; amounts parsed to cents; missing notes_last_updated falls back', () => {
  const d = HS.normaliseDeal(deal('1', '[demo] X', { amount: '18000.00', notes_last_updated: '' }, [
    { value: 'contractsent', timestamp: '2026-11-10T00:00:00.000Z' }, { value: 'appointmentscheduled', timestamp: '2026-09-01T00:00:00.000Z' },
  ]));
  assert.deepStrictEqual(d.stageHistory.map((h) => h.value), ['appointmentscheduled', 'contractsent']);
  assert.strictEqual(d.amountCents, 1800000);
  assert.strictEqual(d.lastActivityAt, '2026-11-10T00:00:00.000Z', 'no notes: the latest stage entry');
  const e = HS.normaliseDeal(deal('2', '[demo] Y', { notes_last_updated: '' }));
  assert.strictEqual(e.lastActivityAt, '2026-11-17T15:00:00.000Z', 'no notes, no history: createdate');
  assert.strictEqual(HS.normaliseDeal(deal('3', '[demo] Z', { amount: 'TBD' })).amountCents, null, 'unparseable amount → null (D-023)');
});

test('collectPages: stops at hubspotMaxPages and reports truncation only when more pages remain', () => {
  const pages = [{ results: [1, 2], paging: { next: { after: 'x' } } }, { results: [3] }];
  assert.deepStrictEqual(HS.collectPages(pages, 1), { records: [1, 2], truncated: true });
  assert.deepStrictEqual(HS.collectPages(pages, 2), { records: [1, 2, 3], truncated: false });
  assert.deepStrictEqual(HS.collectPages([{ results: [1] }], 1), { records: [1], truncated: false });
});
