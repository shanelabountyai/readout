'use strict';
// Report week and the five-week window (PRD §3 step 2, D-005). Monday 00:00 local boundaries computed
// with Intl in the configured zone (no date library); half-open [start, end). Time is passed in.

const DAY_MS = 86400000;
const WEEKDAYS = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 0 };
const fmtCache = new Map();

function formatter(tz) {
  if (!fmtCache.has(tz)) {
    fmtCache.set(tz, new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short',
    }));
  }
  return fmtCache.get(tz);
}

// Local wall-clock parts of a UTC instant.
function localParts(ms, tz) {
  const p = {};
  for (const { type, value } of formatter(tz).formatToParts(new Date(ms))) p[type] = value;
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, s: +p.second, wd: WEEKDAYS[p.weekday] };
}

function offsetMs(ms, tz) {
  const p = localParts(ms, tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1000) * 1000;
}

// UTC instant of local 00:00 on calendar date y-m-d in tz.
function localMidnightUtc(y, m, d, tz) {
  const guess = Date.UTC(y, m - 1, d);
  let t = guess - offsetMs(guess, tz);
  t = guess - offsetMs(t, tz);
  return t;
}

function ymd(y, m, d) { // calendar arithmetic only (UTC date fields), never a clock
  const dt = new Date(Date.UTC(y, m - 1, d));
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}
const pad = (n) => String(n).padStart(2, '0');
const isoDate = ({ y, m, d }) => `${y}-${pad(m)}-${pad(d)}`;
const iso = (ms) => new Date(ms).toISOString().replace('.000Z', 'Z');

function weekOf(monday, tz) {
  const next = ymd(monday.y, monday.m, monday.d + 7);
  return { weekStart: isoDate(monday), startUtc: iso(localMidnightUtc(monday.y, monday.m, monday.d, tz)), endUtc: iso(localMidnightUtc(next.y, next.m, next.d, tz)) };
}

function parseMonday(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
  if (!m) return null;
  const c = ymd(+m[1], +m[2], +m[3]);
  if (isoDate(c) !== s) return null;
  if (new Date(Date.UTC(c.y, c.m - 1, c.d)).getUTCDay() !== 1) return null;
  return c;
}

// Monday (calendar date) of the local week containing the instant.
function localMondayOf(runAtIso, tz) {
  const ms = Date.parse(runAtIso);
  if (!Number.isFinite(ms)) throw new Error(`runAt is not an ISO timestamp: ${runAtIso}`);
  const p = localParts(ms, tz);
  return ymd(p.y, p.m, p.d - ((p.wd + 6) % 7));
}

function reportWeek(runAtIso, tz, weekStartOverride = '') {
  let monday;
  if (weekStartOverride) {
    monday = parseMonday(weekStartOverride);
    if (!monday) throw new Error(`weekStartOverride must be a Monday as YYYY-MM-DD: ${weekStartOverride}`);
  } else {
    const cur = localMondayOf(runAtIso, tz);
    monday = ymd(cur.y, cur.m, cur.d - 7);
  }
  const window = [];
  for (let k = 4; k >= 0; k--) window.push(weekOf(ymd(monday.y, monday.m, monday.d - 7 * k), tz));
  const last = window[4];
  return { weekStart: last.weekStart, startUtc: last.startUtc, endUtc: last.endUtc, window };
}

// The calendar week (local Monday to Monday) that contains the run: the spend-cap period (D-019).
function calendarWeekOf(runAtIso, tz) {
  return weekOf(localMondayOf(runAtIso, tz), tz);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// "Mon 16 Nov – Sun 22 Nov 2026" (PRD §7)
function rangeLabel(weekStart) {
  const a = parseMonday(weekStart);
  if (!a) throw new Error(`not a Monday: ${weekStart}`);
  const b = ymd(a.y, a.m, a.d + 6);
  const left = `Mon ${a.d} ${MONTHS[a.m - 1]}${a.y !== b.y ? ` ${a.y}` : ''}`;
  return `${left} – Sun ${b.d} ${MONTHS[b.m - 1]} ${b.y}`;
}

function hoursBetween(aIso, bIso) { return (Date.parse(bIso) - Date.parse(aIso)) / 3600000; }

module.exports = { DAY_MS, reportWeek, calendarWeekOf, rangeLabel, parseMonday, hoursBetween, localMidnightUtc };
