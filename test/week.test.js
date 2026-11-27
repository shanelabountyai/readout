'use strict';
// AC-01
const test = require('node:test');
const assert = require('node:assert');
const W = require('../src/week');
const TZ = 'America/Chicago';

test('AC-01: the Monday 10:00 run and a 07:00 run report 2026-11-16 → 2026-11-23 (UTC 06:00)', () => {
  for (const at of ['2026-11-23T16:00:00Z', '2026-11-23T13:00:00Z']) {
    const r = W.reportWeek(at, TZ);
    assert.strictEqual(r.weekStart, '2026-11-16');
    assert.strictEqual(r.startUtc, '2026-11-16T06:00:00Z');
    assert.strictEqual(r.endUtc, '2026-11-23T06:00:00Z');
  }
});

test('AC-01: a run at exactly Monday 00:00 local reports the week that just ended; a second earlier reports the one before', () => {
  assert.strictEqual(W.reportWeek('2026-11-23T06:00:00Z', TZ).weekStart, '2026-11-16');
  assert.strictEqual(W.reportWeek('2026-11-23T05:59:59Z', TZ).weekStart, '2026-11-09');
});

test('AC-01: DST weeks are 169 hours (2026-10-26) and 167 hours (2027-03-08); the window is five weeks oldest first', () => {
  const r = W.reportWeek('2026-11-23T16:00:00Z', TZ);
  assert.deepStrictEqual(r.window.map((w) => w.weekStart), ['2026-10-19', '2026-10-26', '2026-11-02', '2026-11-09', '2026-11-16']);
  assert.strictEqual(W.hoursBetween(r.window[1].startUtc, r.window[1].endUtc), 169);
  assert.strictEqual(r.window[0].startUtc, '2026-10-19T05:00:00Z');
  const s = W.reportWeek('2027-03-20T16:00:00Z', TZ, '2027-03-08');
  assert.strictEqual(W.hoursBetween(s.startUtc, s.endUtc), 167);
  for (let i = 1; i < 5; i++) assert.strictEqual(r.window[i].startUtc, r.window[i - 1].endUtc, 'contiguous, half-open');
});

test('calendarWeekOf (the spend-cap week) and the override', () => {
  assert.deepStrictEqual(W.calendarWeekOf('2026-11-23T16:00:00Z', TZ), { weekStart: '2026-11-23', startUtc: '2026-11-23T06:00:00Z', endUtc: '2026-11-30T06:00:00Z' });
  assert.strictEqual(W.reportWeek('2026-11-23T16:00:00Z', TZ, '2026-11-02').weekStart, '2026-11-02');
  assert.throws(() => W.reportWeek('2026-11-23T16:00:00Z', TZ, '2026-11-03'), /Monday/);
  assert.throws(() => W.reportWeek('2026-11-23T16:00:00Z', TZ, '2026-02-30'), /Monday/);
});

test('rangeLabel: "Mon 16 Nov – Sun 22 Nov 2026", years shown on both sides across New Year', () => {
  assert.strictEqual(W.rangeLabel('2026-11-16'), 'Mon 16 Nov – Sun 22 Nov 2026');
  assert.strictEqual(W.rangeLabel('2026-12-28'), 'Mon 28 Dec 2026 – Sun 3 Jan 2027');
});
