'use strict';
// The fixtures exist, are complete, and stay generated from spec.js (npm run check also enforces drift).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const H = require('./harness');
const S = require('../fixtures/spec');
const { files } = require('../fixtures/build');

const IDS = Array.from({ length: 20 }, (_, i) => `E${String(i + 1).padStart(2, '0')}`);

test('every PRD §9 golden week E01–E20 has a week file and an expected file; index lists all twenty', () => {
  assert.deepStrictEqual(S.WEEKS.map((w) => w.id), IDS);
  for (const id of IDS) {
    assert.ok(fs.existsSync(path.join(H.FIX, 'weeks', `${id}.json`)), id);
    assert.ok(fs.existsSync(path.join(H.FIX, 'expected', `${id}.json`)), id);
  }
  assert.deepStrictEqual(H.readJson('index.json').map((x) => x.id), IDS);
});

test('recorded stand-ins: present for every week that calls the model, absent for E02, E16 and E20; seven variants', () => {
  for (const id of IDS) assert.strictEqual(fs.existsSync(path.join(H.FIX, 'recorded', `${id}.json`)), !['E02', 'E16', 'E20'].includes(id), id);
  assert.strictEqual(fs.readdirSync(path.join(H.FIX, 'recorded', 'variants')).length, 7);
  for (const f of fs.readdirSync(path.join(H.FIX, 'recorded')).filter((x) => x.endsWith('.json'))) assert.match(H.readJson(`recorded/${f}`).note, /NOT model output/);
});

test('expected files are the hand-typed spec blocks, unchanged', () => {
  for (const w of S.WEEKS) assert.deepStrictEqual(H.loadExpected(w.id), JSON.parse(JSON.stringify(w.expected)), w.id);
});

test('committed fixtures equal what build.js writes (no drift)', () => {
  for (const [rel, text] of Object.entries(files())) assert.strictEqual(fs.readFileSync(path.join(H.FIX, rel), 'utf8'), text, rel);
});

test('synthetic data only: every contact email is on .example except the one .test record in E18; every deal and task is [demo]', () => {
  for (const id of IDS) {
    const w = H.loadWeek(id);
    const emails = w.contacts.flatMap((p) => p.results).map((c) => c.properties.email);
    for (const e of emails) assert.ok(e.endsWith('.example') || (id === 'E18' && e === 'lead@newprospect.test'), `${id}: ${e}`);
    for (const d of w.deals.flatMap((p) => p.results)) assert.ok(d.properties.dealname.startsWith('[demo] '), d.properties.dealname);
    for (const t of w.tasks.flatMap((p) => p.results)) assert.ok(t.properties.hs_task_subject.startsWith('[demo] '));
  }
  assert.match(H.baseCfg.ownerEmail, /\.example$/);
});
