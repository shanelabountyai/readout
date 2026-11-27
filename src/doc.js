'use strict';
// The Google Doc as HTML (PRD §7, D-044, D-048). Every model string is escaped; on a non-pass path no model
// string is passed in at all, so none can appear.
const week = require('./week');
const template = require('./template');

const FOOTER = 'Numbers computed by code from HubSpot and the weekly sheet · narrative by Claude, checked against them · review before relying on it';
const FOOTNOTE = 'differences use the unrounded average';
const IDEAS_HEADING = 'Ideas from the model (not findings)';
const WATCH_CODES = new Set(['quiet_week', 'stalled_deals', 'overdue_tasks', 'revenue_swing', 'cash_drop']);
const DATA_CODES = new Set(['sheet_missing', 'sheet_invalid', 'history_short', 'hubspot_truncated', 'demo_guard_skipped']);
const DEFINITIONS = [
  ['Moved', 'a deal whose stage changed to a different open stage during the week; wins and losses are counted separately, not as moves.'],
  ['Won value (CRM) and revenue', 'won value is the amount of deals won in the week (bookings, from HubSpot); revenue is what was typed into the weekly sheet. They are never combined.'],
  ['Stalled', 'an open deal idle longer than its stage allows, in whole days to the week end, from the later of its last logged activity and its last stage change.'],
  ['Overdue', 'a task due before the week end that was not completed when the run read it.'],
  ['Snapshot timing', 'open pipeline and overdue tasks are as of the run; stalled deals are at the week end. These three have no history.'],
  ['4-week average', 'the mean of the four weeks before this one; differences use the unrounded average.'],
];

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function title(weekStart) { return `Weekly Pulse — week of ${weekStart}`; }

function dataNotes({ flags, notes }) {
  const lines = flags.filter((f) => DATA_CODES.has(f.code)).map((f) => f.sentence);
  const n = notes || {};
  if (n.wonMissingAmount) lines.push(`${n.wonMissingAmount} won deal${n.wonMissingAmount === 1 ? '' : 's'} in these five weeks had no amount and count as $0`);
  if (n.openMissingAmount) lines.push(`${n.openMissingAmount} open deal${n.openMissingAmount === 1 ? '' : 's'} had no amount and count as $0 in open pipeline`);
  if (n.unknownStages && n.unknownStages.length) lines.push(`Stages with no idle limit in rules/stale.json (never marked stalled): ${n.unknownStages.join(', ')}`);
  lines.push('Past weeks of the CRM counts are recomputed from today\'s CRM, so a deleted, reopened or re-dated deal can change them from what an earlier page showed.');
  lines.push('Overdue tasks are judged when the run reads them: a task completed after the week end is not counted.');
  return lines;
}

// input: { cfg, weekStart, facts, flags, metricsList, snapshot, notes, narrative (checked or template) | null,
//          withheldReason (when narrative is null), suggestionsAllowed }
function render(input) {
  const { cfg, weekStart, facts, flags, metricsList, snapshot, narrative, withheldReason } = input;
  const f = new Map(facts.map((x) => [x.id, x.rendering]));
  const cell = (id) => esc(f.has(id) ? f.get(id) : '—');
  const pair = (a, b) => (f.has(a) ? `${esc(f.get(a))}${f.has(b) ? ` (${esc(f.get(b))})` : ''}` : '—');
  const h = [];
  h.push('<html><head><meta charset="utf-8"></head><body>');
  h.push(`<p>${esc(week.rangeLabel(weekStart))} · ${esc(cfg.firmName)} · Drafted by N3</p>`);
  const headline = narrative ? narrative.headline.text : template.codeHeadline(weekStart);
  h.push(`<h1>${esc(headline)}</h1>`);
  if (narrative) for (const p of narrative.paragraphs) h.push(`<p>${esc(p.text)}</p>`);
  else h.push(`<p>Narrative withheld: ${esc(template.REASON_WORDS[withheldReason] || withheldReason)}.</p>`);

  h.push('<h2>Watch</h2>');
  const watch = flags.filter((x) => WATCH_CODES.has(x.code));
  if (!watch.length) h.push('<p>Nothing flagged this week.</p>');
  else {
    h.push('<ul>');
    for (const w of watch) {
      if (w.code === 'stalled_deals') for (const s of snapshot.stalled) h.push(`<li>Stalled: ${esc(s.name)} — ${esc(s.stage)}, idle ${s.idleDays} days at week end</li>`);
      else h.push(`<li>${esc(w.sentence)}</li>`);
    }
    h.push('</ul>');
  }

  h.push('<h2>Numbers</h2>');
  h.push('<table><tr><th>Metric</th><th>This week</th><th>Last week</th><th>4-week avg</th><th>vs last week</th><th>vs avg</th></tr>');
  for (const m of metricsList) {
    h.push(`<tr><td>${esc(m.label)}</td><td>${cell(`${m.key}.cur`)}</td><td>${cell(`${m.key}.prev`)}</td><td>${cell(`${m.key}.avg4`)}</td><td>${pair(`${m.key}.wow_abs`, `${m.key}.wow_pct`)}</td><td>${pair(`${m.key}.avg_abs`, `${m.key}.avg_pct`)}</td></tr>`);
  }
  for (const [key, label] of [['open_pipeline', 'Open pipeline (as of the run)'], ['stalled_deals', 'Stalled deals (at week end)'], ['overdue_tasks', 'Overdue tasks (as of the run)']]) {
    h.push(`<tr><td>${esc(label)}</td><td>${cell(`${key}.cur`)}</td><td>—</td><td>—</td><td>—</td><td>—</td></tr>`);
  }
  h.push('</table>');
  h.push(`<p><small>${esc(FOOTNOTE)}. Snapshot rows have no history; — means not available (see Data notes).</small></p>`);

  if (narrative && narrative.suggestions.length) {
    h.push(`<h2>${esc(IDEAS_HEADING)}</h2><ul>`);
    for (const s of narrative.suggestions) h.push(`<li>${esc(s.text)}</li>`);
    h.push('</ul>');
  }
  h.push('<h2>Data notes</h2><ul>');
  for (const l of dataNotes(input)) h.push(`<li>${esc(l)}</li>`);
  h.push('</ul>');
  h.push('<h2>Definitions</h2><ul>');
  for (const [k, v] of DEFINITIONS) h.push(`<li><b>${esc(k)}</b>: ${esc(v)}</li>`);
  h.push('</ul>');
  h.push(`<p><small>${esc(FOOTER)}</small></p>`);
  h.push('</body></html>');
  return { title: title(weekStart), html: h.join('\n'), headline };
}

module.exports = { FOOTER, FOOTNOTE, IDEAS_HEADING, DEFINITIONS, esc, title, render, dataNotes };
