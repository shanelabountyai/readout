'use strict';
// The narrative checks (PRD §6, D-008 to D-011, D-043; links and placeholders added by D-055). No model.
// Each check runs over every part; all failures are kept; `reason` is the failure whose check comes first
// in REASONS order. The input must already have passed schema.validatePulse (check 1 is run here too).
const num = require('./num');
const { validatePulse } = require('./schema');

const REASONS = [
  'schema', 'too_long', 'cited_fact_missing', 'number_not_in_metrics', 'number_not_in_cited_facts', 'direction_mismatch',
  'number_in_suggestion', 'spelled_number', 'advice_in_facts', 'causal_claim', 'unverifiable_claim', 'link', 'placeholder',
];

// Word lists (PRD §6), whole words or phrases, case-insensitive. Exported so tests and docs can quote them.
const RISE_WORDS = ['rose', 'up', 'increased', 'grew', 'gained', 'higher', 'climbed'];
const FALL_WORDS = ['fell', 'down', 'decreased', 'dropped', 'declined', 'lower', 'slipped'];
const SPELLED_NUMBERS = ['two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty', 'dozen', 'hundred', 'thousand', 'million', 'billion'];
const ADVICE_WORDS = ['should', 'must', 'need to', 'needs to', 'recommend', 'consider', 'suggest', 'ought', 'make sure', 'prioritize', 'prioritise', 'focus on'];
const CAUSAL_WORDS = ['because', 'due to', 'driven by', 'caused by', 'as a result', 'thanks to', 'owing to', 'led to', 'resulted in'];
const UNVERIFIABLE_WORDS = ['doubled', 'tripled', 'halved', 'twice', 'record', 'all-time', 'highest', 'lowest', 'best', 'worst'];
const STRIP_PHRASES = ['4-week', 'four-week', 'week-over-week'];
// D-055: links and template placeholders are never allowed in any part.
const LINK_RE = /https?:\/\/|\bwww\.|\]\(|\b[a-z0-9][a-z0-9-]*\.(?:com|net|org|io|co|ai|app|dev|example|test)\b/i;
const PLACEHOLDER_RE = /\[[^\]]*\]|\{\{|\}\}|<[^>\s][^>]*>|\b(?:TODO|TBD|TKTK|XXX|lorem ipsum|placeholder)\b/i;

const TOKEN_RE = /([+\-−])?(\$)?(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?(%)?/g;
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// A hyphen does not join words for these lists ("twenty-five", "record-high", "must-win" all match), and a
// phrase matches across any whitespace (D-066). Direction words keep the hyphen guard so "follow-up" is not "up".
const phrase = (w) => w.split(' ').map(esc).join('\\s+');
const wordRe = (list) => new RegExp(`(?<![A-Za-z0-9])(?:${list.map(phrase).join('|')})(?![A-Za-z0-9])`, 'i');
const directionRe = (list) => new RegExp(`(?<![A-Za-z0-9-])(?:${list.map(esc).join('|')})(?![A-Za-z0-9-])`, 'i');
const RISE_RE = directionRe(RISE_WORDS);
const FALL_RE = directionRe(FALL_WORDS);
const SPELLED_RE = wordRe(SPELLED_NUMBERS);
const ADVICE_RE = wordRe(ADVICE_WORDS);
const CAUSAL_RE = wordRe(CAUSAL_WORDS);
const UNVERIFIABLE_RE = wordRe(UNVERIFIABLE_WORDS);

// Remove the fixed phrases, ISO dates and stalled deals' names (with and without the [demo] prefix).
function strip(text, stalledNames = []) {
  let t = text;
  const names = [];
  for (const n of stalledNames) { names.push(n); if (n.startsWith('[demo]')) names.push(n.slice(6).trim()); }
  for (const n of names.filter(Boolean).sort((a, b) => b.length - a.length)) t = t.replace(new RegExp(esc(n), 'gi'), ' ');
  for (const p of STRIP_PHRASES) t = t.replace(new RegExp(esc(p), 'gi'), ' ');
  return t.replace(/\d{4}-\d{2}-\d{2}/g, ' ');
}

const words = (text) => text.split(/\s+/).filter(Boolean).length;
function sentences(text) { return text.split(/(?<=[.!?])(?:\s+|$)/).filter((s) => s.trim()); }
function tokens(text) {
  const out = [];
  for (const m of text.matchAll(TOKEN_RE)) {
    const raw = m[0];
    const { type, value } = num.magnitudeOf(raw.replace(/^[+\-−]/, ''));
    out.push({ raw, type, value, sign: m[1] ? (m[1] === '+' ? 1 : -1) : 0 });
  }
  return out;
}
const matches = (tok, facts) => facts.filter((f) => f.type === tok.type && num.magnitudeOf(f.rendering).value === tok.value);

// narrative: write_pulse input; facts: facts.build() output; stalledNames: deal names
function check(narrative, facts, stalledNames = []) {
  const failures = [];
  const fail = (reason, part, token) => failures.push(token === undefined ? { reason, part } : { reason, part, token });
  const v = validatePulse(narrative);
  if (!v.ok) return { pass: false, reason: 'schema', failures: v.errors.map((e) => ({ reason: 'schema', part: e })) };

  const ids = new Map(facts.map((f) => [f.id, f]));
  const parts = [
    { part: 'headline', text: narrative.headline.text, cites: narrative.headline.cites, prose: true },
    ...narrative.paragraphs.map((p, i) => ({ part: `paragraphs[${i}]`, text: p.text, cites: p.cites, prose: true })),
    ...narrative.suggestions.map((s, i) => ({ part: `suggestions[${i}]`, text: s.text, cites: [], prose: false })),
  ];

  // 2 too_long
  if (words(narrative.headline.text) > 15) fail('too_long', 'headline');
  const total = parts.filter((p) => p.prose).reduce((a, p) => a + words(p.text), 0);
  if (total > 180) fail('too_long', 'headline+paragraphs');
  for (const p of parts.filter((x) => !x.prose)) if (words(p.text) > 30) fail('too_long', p.part);

  for (const p of parts) {
    const clean = strip(p.text, stalledNames);
    if (p.prose) {
      // 3 cited_fact_missing
      for (const id of p.cites) if (!ids.has(id)) fail('cited_fact_missing', p.part, id);
      const cited = p.cites.filter((id) => ids.has(id)).map((id) => ids.get(id));
      // 4, 5 numbers
      for (const t of tokens(clean)) {
        const any = matches(t, facts);
        if (any.length === 0) fail('number_not_in_metrics', p.part, t.raw);
        else if (matches(t, cited).length === 0) fail('number_not_in_cited_facts', p.part, t.raw);
      }
      // 6 direction, per sentence; and explicit signs
      for (const s of sentences(clean)) {
        const rise = RISE_RE.test(s);
        const fall = FALL_RE.test(s);
        for (const t of tokens(s)) {
          const m = matches(t, cited);
          if (rise !== fall) {
            const want = rise ? 1 : -1;
            if (m.some((f) => f.isDelta && f.sign !== want)) fail('direction_mismatch', p.part, t.raw);
          }
          if (t.sign !== 0 && m.length && m.every((f) => f.sign !== t.sign)) fail('direction_mismatch', p.part, t.raw);
        }
      }
    } else if (/\d/.test(clean)) fail('number_in_suggestion', p.part); // 7
    if (SPELLED_RE.test(clean)) fail('spelled_number', p.part); // 8
    if (p.prose && ADVICE_RE.test(clean)) fail('advice_in_facts', p.part); // 9
    if (CAUSAL_RE.test(clean)) fail('causal_claim', p.part); // 10
    if (p.prose && UNVERIFIABLE_RE.test(clean)) fail('unverifiable_claim', p.part); // 11
    if (LINK_RE.test(clean)) fail('link', p.part); // 12 (D-055)
    if (PLACEHOLDER_RE.test(clean)) fail('placeholder', p.part); // 13 (D-055)
  }
  const first = REASONS.find((r) => failures.some((f) => f.reason === r));
  return { pass: !first, reason: first || '', failures };
}

module.exports = {
  REASONS, RISE_WORDS, FALL_WORDS, SPELLED_NUMBERS, ADVICE_WORDS, CAUSAL_WORDS, UNVERIFIABLE_WORDS, STRIP_PHRASES,
  LINK_RE, PLACEHOLDER_RE, TOKEN_RE, strip, tokens, sentences, words, check,
};
