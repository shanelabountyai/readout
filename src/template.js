'use strict';
// Code-written text (D-013, D-044): the quiet-week narrative, the headline used on every non-pass path,
// and the plain-words line for each reason code.
const week = require('./week');

// Every reason the ledger can hold (src/ledger.js), in plain words for the owner.
const REASON_WORDS = {
  schema: 'the draft came back in the wrong shape',
  too_long: 'the draft was longer than the page allows',
  cited_fact_missing: 'the draft relied on a figure that is not available this week',
  number_not_in_metrics: 'the draft quoted a number the data does not contain',
  number_not_in_cited_facts: 'the draft attached a number to the wrong figure',
  direction_mismatch: 'the draft described a change in the wrong direction',
  number_in_suggestion: 'an idea in the draft contained a number',
  spelled_number: 'the draft wrote a number out in words, which cannot be checked',
  advice_in_facts: 'the draft gave advice as if it were a finding',
  causal_claim: 'the draft claimed a cause the data cannot show',
  unverifiable_claim: 'the draft made a claim the numbers cannot confirm',
  link: 'the draft contained a link',
  placeholder: 'the draft contained unfilled placeholder text',
  template_check: 'the code-written summary failed its own check',
  weekly_cap: 'this week\'s limit on model calls was already reached',
  token_ceiling: 'the request to the model would have been larger than the per-run limit',
  spend_cap: 'this week\'s model spending limit was already reached',
  model_error: 'the model could not be reached',
  hubspot_error: 'the CRM could not be read',
  sheet_error: 'the weekly sheet or the ledger could not be read',
  drive_error: 'the page could not be saved to Drive',
  gmail_error: 'the draft email could not be saved',
  unknown_error: 'the run stopped on an unexpected error',
  demo_guard_recipient: 'the owner address is outside the demo set, so no draft was made',
};

const QUIET_HEADLINE = 'Quiet week in the CRM';

function codeHeadline(weekStart) { return `Weekly pulse: ${week.rangeLabel(weekStart)}`; }

// The quiet-week narrative: no digits in the headline, never a direction word, cites what it states.
function quietNarrative(factsList) {
  const f = new Map(factsList.map((x) => [x.id, x]));
  const parts = [];
  const cites = [];
  const nc = f.get('new_contacts.cur');
  parts.push(`No deals were created, moved, won or lost this week, and ${nc.rendering} new contact${nc.rendering === '1' ? ' was' : 's were'} added.`);
  cites.push('new_contacts.cur');
  const rev = f.get('revenue.cur');
  const cash = f.get('cash.cur');
  if (rev && cash) { parts.push(`Revenue was ${rev.rendering} and cash at week end was ${cash.rendering}.`); cites.push('revenue.cur', 'cash.cur'); }
  else if (rev) { parts.push(`Revenue was ${rev.rendering}; cash was not entered.`); cites.push('revenue.cur'); }
  else if (cash) { parts.push(`Cash at week end was ${cash.rendering}; revenue was not entered.`); cites.push('cash.cur'); }
  else parts.push('Revenue and cash were not entered.');
  return { headline: { text: QUIET_HEADLINE, cites: [] }, paragraphs: [{ text: parts.join(' '), cites }], suggestions: [] };
}

module.exports = { REASON_WORDS, QUIET_HEADLINE, codeHeadline, quietNarrative };
