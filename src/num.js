'use strict';
// Integer arithmetic and every rendering the page, the prompt and the checks use (PRD §4, D-006).
// Money is integer cents; averages are sum4/4 rationals; percentages are {num, den}. One rounding
// function, half away from zero, applied once per displayed value. The only file in src/ allowed
// to use Math.round, parseFloat or toFixed (test/structure.test.js); it uses none of the first two.

const MINUS = '−'; // U+2212, the minus sign in every rendering

function sgn(n) { return n > 0 ? 1 : n < 0 ? -1 : 0; }

// round(num / den), half away from zero; den any non-zero integer.
function roundHalfAway(num, den) {
  if (!Number.isInteger(num) || !Number.isInteger(den) || den === 0) throw new Error(`roundHalfAway needs integers, got ${num}/${den}`);
  if (den < 0) { num = -num; den = -den; }
  const a = Math.abs(num);
  const q = Math.floor(a / den);
  const r = a - q * den;
  const v = 2 * r >= den ? q + 1 : q;
  return num < 0 ? -v : v;
}

function groupThousands(nonNegInt) {
  return String(nonNegInt).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// Sheets FORMATTED_VALUE money strings (D-024, D-047): optional leading - or −, optional $, digits with
// well-formed commas or none, up to two decimals. `46k`, `4.5m`, `46,00`, `1.234`, `($5,000)` are rejected.
const DOLLARS_RE = /^([-−])?\$?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/;
function parseDollars(str) {
  if (typeof str === 'number') str = String(str);
  if (typeof str !== 'string') return { ok: false };
  const m = DOLLARS_RE.exec(str.trim());
  if (!m) return { ok: false };
  const whole = Number(m[2].replace(/,/g, ''));
  const frac = m[3] ? Number(m[3].padEnd(2, '0')) : 0;
  const cents = whole * 100 + frac;
  if (!Number.isSafeInteger(cents)) return { ok: false };
  return { ok: true, cents: m[1] && cents !== 0 ? -cents : cents };
}

// Whole counts typed in the sheet (extra metrics with unit `count`).
const COUNT_RE = /^(\d{1,3}(?:,\d{3})+|\d+)$/;
function parseCount(str) {
  if (typeof str === 'number') str = String(str);
  if (typeof str !== 'string') return { ok: false };
  const m = COUNT_RE.exec(str.trim());
  if (!m) return { ok: false };
  const n = Number(m[1].replace(/,/g, ''));
  return Number.isSafeInteger(n) ? { ok: true, value: n } : { ok: false };
}

function signed(prefix, magnitudeText, s) {
  if (s === 0) return magnitudeText;
  return (s > 0 ? '+' : MINUS) + prefix + magnitudeText;
}

// Counts
function renderCount(n) { return n < 0 ? MINUS + String(-n) : String(n); }
function tenths(t) { // integer tenths → "8.3", "−0.8", "0.0"
  const a = Math.abs(t);
  return `${Math.floor(a / 10)}.${a % 10}`;
}
function renderCountAvg(sum4) { const t = roundHalfAway(sum4 * 10, 4); return (t < 0 ? MINUS : '') + tenths(t); }
function renderCountDelta(d) { return d === 0 ? '0' : signed('', String(Math.abs(d)), sgn(d)); }
function renderCountAvgDelta(num4) { // (4·cur − sum4) / 4
  const t = roundHalfAway(num4 * 10, 4);
  return t === 0 ? '0.0' : signed('', tenths(t), sgn(t));
}

// Money (cents in, whole dollars out)
function dollars(cents, den = 100) { return roundHalfAway(cents, den); }
function renderMoney(cents) { const d = dollars(cents); return (d < 0 ? MINUS : '') + '$' + groupThousands(Math.abs(d)); }
function renderMoneyAvg(sum4) { const d = dollars(sum4, 400); return (d < 0 ? MINUS : '') + '$' + groupThousands(Math.abs(d)); }
function renderMoneyDelta(cents) { const d = dollars(cents); return d === 0 ? '$0' : signed('$', groupThousands(Math.abs(d)), sgn(d)); }
function renderMoneyAvgDelta(num4) { const d = dollars(num4, 400); return d === 0 ? '$0' : signed('$', groupThousands(Math.abs(d)), sgn(d)); }

// Percentages: whole percent with sign, from an exact {num, den}
function renderPct(num, den) { const p = roundHalfAway(num, den); return p === 0 ? '0%' : signed('', `${Math.abs(p)}%`, sgn(p)); }

// Exact decimal value of a number token or a rendering, as a canonical string: sign, `$`, commas and `%`
// removed; leading zeros of the integer part and trailing zeros of the fraction dropped ("8.0" → "8").
function canonicalDecimal(text) {
  const m = /^[+\-−]?\$?([\d,]+)(?:\.(\d+))?%?$/.exec(text);
  if (!m) return null;
  const int = m[1].replace(/,/g, '').replace(/^0+(?=\d)/, '');
  const frac = (m[2] || '').replace(/0+$/, '');
  return frac ? `${int}.${frac}` : int;
}

// { type: 'count' | 'money' | 'pct', value: canonical decimal string } for a rendering or a token.
function magnitudeOf(text) {
  const type = text.includes('$') ? 'money' : text.endsWith('%') ? 'pct' : 'count';
  return { type, value: canonicalDecimal(text) };
}

// Model cost in dollars for the ledger, six decimals. Not business money; never in metric arithmetic.
function renderUsdCost(x) { return x === null || x === undefined ? '' : Number(x).toFixed(6); }

module.exports = {
  MINUS, sgn, roundHalfAway, groupThousands, parseDollars, parseCount,
  renderCount, renderCountAvg, renderCountDelta, renderCountAvgDelta,
  renderMoney, renderMoneyAvg, renderMoneyDelta, renderMoneyAvgDelta, renderPct,
  canonicalDecimal, magnitudeOf, renderUsdCost,
};
