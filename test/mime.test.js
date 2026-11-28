'use strict';
// src/mime.js: the Drive multipart body and the Gmail raw message, checked against Node's own Buffer encoders.
const test = require('node:test');
const assert = require('node:assert');
const M = require('../src/mime');
const S = require('./simrun');

test('utf8 and base64 agree with Buffer on ASCII, the page\'s dashes and minus sign, and a 4-byte character', () => {
  for (const s of ['', 'a', 'ab', 'abc', 'Weekly pulse — week of 2026-11-16', '−$14,000 · “quoted”', 'x\u{1F4C8}y']) {
    assert.deepStrictEqual(M.utf8(s), [...Buffer.from(s, 'utf8')], s);
    assert.strictEqual(M.base64(M.utf8(s)), Buffer.from(s, 'utf8').toString('base64'), s);
    assert.strictEqual(M.base64url(M.utf8(s)), Buffer.from(s, 'utf8').toString('base64url'), s);
  }
});

test('rawMessage: one recipient, UTF-8 plain text in base64, round-trips to the same to/subject/body', () => {
  const body = 'Revenue (as entered): $46,000 (+$4,000 vs last week)\nDeals lost: −1\n\nThe page: https://docs.google.com/document/d/doc-1/edit';
  const raw = M.rawMessage({ to: 'owner@tallgrassadvisory.example', subject: 'Weekly pulse: week of 2026-11-16', body });
  assert.match(raw, /^[A-Za-z0-9_-]+$/, 'base64url, no padding');
  const d = S.draftText({ raw });
  assert.deepStrictEqual([d.to, d.subject, d.body], ['owner@tallgrassadvisory.example', 'Weekly pulse: week of 2026-11-16', body]);
  assert.deepStrictEqual(Object.keys(d.headers), ['To', 'Subject', 'MIME-Version', 'Content-Type', 'Content-Transfer-Encoding']);
  assert.strictEqual(S.draftText({ raw: M.rawMessage({ to: 'a@b.example', subject: 'Pulse — x', body: '' }) }).subject, 'Pulse — x', 'non-ASCII subject encoded');
});

test('rawMessage refuses a list or a display-name recipient (owner only, D-016) and strips newlines from the subject', () => {
  assert.throws(() => M.rawMessage({ to: 'a@b.example, c@d.example', subject: 's', body: '' }));
  assert.throws(() => M.rawMessage({ to: 'Owner <a@b.example>', subject: 's', body: '' }));
  const d = S.draftText({ raw: M.rawMessage({ to: 'a@b.example', subject: 'x\r\nBcc: c@d.example', body: '' }) });
  assert.strictEqual(d.headers.Bcc, undefined, 'no header injection');
});

test('multipart: metadata part, HTML part, closing boundary; refuses a page that contains the boundary', () => {
  const body = M.multipart({ name: 'T' }, '<p>x</p>');
  assert.strictEqual(body, `--${M.BOUNDARY}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{"name":"T"}\r\n--${M.BOUNDARY}\r\nContent-Type: text/html; charset=UTF-8\r\n\r\n<p>x</p>\r\n--${M.BOUNDARY}--\r\n`);
  assert.strictEqual(M.MULTIPART_TYPE, `multipart/related; boundary=${M.BOUNDARY}`);
  assert.throws(() => M.multipart({}, `a ${M.BOUNDARY} b`));
});
