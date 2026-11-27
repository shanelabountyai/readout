'use strict';
// AC-08 (metrics-only page), PRD §7
const test = require('node:test');
const assert = require('node:assert');
const D = require('../src/doc');
const H = require('./harness');
const fs = require('fs');
const path = require('path');

test('E01: title, range header, model headline, numbers table with footnote, Definitions, Data notes and footer', () => {
  const r = H.runWeek('E01');
  assert.strictEqual(r.doc.title, 'Weekly Pulse — week of 2026-11-16');
  assert.match(r.docHtml, /Mon 16 Nov – Sun 22 Nov 2026 · Tallgrass Advisory · Drafted by N3/);
  assert.match(r.docHtml, /<h1>The week in numbers<\/h1>/);
  assert.match(r.docHtml, /<td>Revenue \(as entered\)<\/td><td>\$46,000<\/td><td>\$42,000<\/td><td>\$41,000<\/td><td>\+\$4,000 \(\+10%\)<\/td><td>\+\$5,000 \(\+12%\)<\/td>/);
  assert.match(r.docHtml, /<td>Won value \(CRM\)<\/td>/);
  assert.match(r.docHtml, /<td>Open pipeline \(as of the run\)<\/td><td>\$210,000<\/td>/);
  assert.ok(r.docHtml.includes(D.FOOTNOTE));
  assert.ok(r.docHtml.includes('<h2>Definitions</h2>'));
  assert.ok(r.docHtml.includes('<h2>Data notes</h2>'));
  assert.ok(r.docHtml.includes('recomputed from today&#39;s CRM'));
  assert.ok(r.docHtml.includes(D.FOOTER));
  assert.strictEqual(D.FOOTER, 'Numbers computed by code from HubSpot and the weekly sheet · narrative by Claude, checked against them · review before relying on it');
});

test('every model string is HTML-escaped', () => {
  const r = H.runWeek('E01');
  const narrative = { headline: { text: '<script>alert(1)</script>', cites: [] }, paragraphs: [{ text: 'a & b <b>', cites: [] }], suggestions: [{ text: '"q" <i>' }] };
  const html = D.render({ cfg: H.baseCfg, weekStart: '2026-11-16', facts: r.facts, flags: r.flags, metricsList: r.computed.metricsList, snapshot: r.computed.snapshot, notes: r.computed.notes, narrative }).html;
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(html.includes('a &amp; b &lt;b&gt;'));
  assert.ok(html.includes('&quot;q&quot; &lt;i&gt;'));
});

test('AC-08: E16 (cap) shows the code headline and the withheld line in plain words, and no stand-in text at all', () => {
  const r = H.runWeek('E16');
  assert.match(r.docHtml, /<h1>Weekly pulse: Mon 16 Nov – Sun 22 Nov 2026<\/h1>/);
  assert.ok(r.docHtml.includes('Narrative withheld: this week&#39;s limit on model calls was already reached.'));
  const dir = path.join(H.FIX, 'recorded');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    const s = H.readJson(`recorded/${f}`).input;
    for (const p of [s.headline.text, ...s.paragraphs.map((x) => x.text)]) assert.ok(!r.docHtml.includes(D.esc(p)), `${f}: ${p}`);
  }
});

test('AC-08: a failed check (E09) yields code headline, numbers table, Watch list and withheld line; no model text', () => {
  const r = H.runWeek('E09');
  const s = H.loadRecorded('E09').input;
  assert.ok(!r.docHtml.includes('Revenue rose 27%'));
  assert.ok(!r.docHtml.includes(s.headline.text));
  assert.ok(r.docHtml.includes('Narrative withheld: the draft described a change in the wrong direction.'));
  assert.match(r.docHtml, /<h2>Watch<\/h2>\n<ul>\n<li>Revenue is 27% below its 4-week average<\/li>/);
  assert.ok(r.docHtml.includes('<h2>Numbers</h2>'));
  assert.ok(!r.docHtml.includes(D.IDEAS_HEADING));
  assert.strictEqual(r.ledgerRow[2], 'metrics_only');
});

test('E12: the suggestion appears under "Ideas from the model (not findings)"; E08 stalled deal by name in Watch', () => {
  const r = H.runWeek('E12');
  assert.match(r.docHtml, /<h2>Ideas from the model \(not findings\)<\/h2><ul>\n<li>Call the Bluewater contact about the contract.<\/li>/);
  assert.match(H.runWeek('E08').docHtml, /<li>Stalled: \[demo\] Bluewater fleet reporting — contractsent, idle 11 days at week end<\/li>/);
});

test('E03 / E19: absent values show — and the gap is in Data notes; E18 and E01-truncated notes', () => {
  const e03 = H.runWeek('E03').docHtml;
  assert.match(e03, /<td>Revenue \(as entered\)<\/td><td>—<\/td><td>\$42,000<\/td><td>\$41,000<\/td><td>—<\/td><td>—<\/td>/);
  assert.ok(e03.includes('<li>Revenue and cash not entered</li>'));
  assert.ok(H.runWeek('E19').docHtml.includes('the 2026-11-16 cell is not a dollar amount or count'));
  assert.ok(H.runWeek('E18').docHtml.includes(`<li>${H.loadExpected('E18').dataNote}</li>`));
  assert.ok(H.runWeek('E01-truncated').docHtml.includes(`<li>${H.loadExpected('E01-truncated').dataNote}</li>`));
});
