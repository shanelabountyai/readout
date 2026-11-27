'use strict';
// The `runs` ledger (D-018, D-045, AC-12): append-only; ids, fixed codes, counts of tokens/calls, model cost,
// seconds and ISO timestamps. buildRow refuses anything else, so no business data can reach the sheet.
const checks = require('./checks');
const flags = require('./flags');

const COLUMNS = ['run_id', 'week_start', 'status', 'reason', 'flags', 'doc_id', 'draft_id', 'draft_state', 'prompt_version', 'model', 'model_calls', 'input_tokens', 'output_tokens', 'cost_usd', 'runtime_s', 'run_at'];
const STATUS = ['done', 'metrics_only', 'failed'];
const REASONS = ['', ...checks.REASONS, 'template_check', 'weekly_cap', 'token_ceiling', 'spend_cap', 'hubspot_error', 'sheet_error', 'drive_error', 'gmail_error', 'model_error', 'demo_guard_recipient'];
const DRAFT_STATES = ['', 'created', 'updated', 'gone', 'skipped'];

const ID_RE = /^[A-Za-z0-9_-]{0,128}$/;
const RULES = {
  run_id: (v) => typeof v === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(v),
  week_start: (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v),
  status: (v) => STATUS.includes(v),
  reason: (v) => REASONS.includes(v),
  flags: (v) => v === '' || (typeof v === 'string' && v.split('|').every((c) => flags.CODES.has(c))),
  doc_id: (v) => typeof v === 'string' && ID_RE.test(v),
  draft_id: (v) => typeof v === 'string' && ID_RE.test(v),
  draft_state: (v) => DRAFT_STATES.includes(v),
  prompt_version: (v) => v === '' || (typeof v === 'string' && /^narrate-v\d+\.\d+$/.test(v)),
  model: (v) => v === '' || (typeof v === 'string' && /^claude-[a-z0-9.-]{1,60}$/.test(v)),
  model_calls: (v) => Number.isInteger(v) && v >= 0 && v < 1000,
  input_tokens: (v) => Number.isInteger(v) && v >= 0,
  output_tokens: (v) => Number.isInteger(v) && v >= 0,
  cost_usd: (v) => v === '' || (typeof v === 'string' && /^\d{1,4}\.\d{6}$/.test(v)),
  runtime_s: (v) => Number.isInteger(v) && v >= 0,
  run_at: (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/.test(v),
};

function buildRow(fields) {
  for (const k of Object.keys(fields)) if (!COLUMNS.includes(k)) throw new Error(`ledger: unknown column ${k}`);
  return COLUMNS.map((k) => {
    if (!(k in fields)) throw new Error(`ledger: missing column ${k}`);
    const v = fields[k];
    if (!RULES[k](v)) throw new Error(`ledger: refused value for ${k}`);
    return v;
  });
}

// values: the tab as read (header row first) → objects keyed by the header.
function records(values) {
  const rows = values || [];
  if (!rows.length) return [];
  const header = rows[0].map((h) => String(h).trim());
  return rows.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] === undefined || r[i] === null ? '' : String(r[i])])));
}

// Each of doc id, draft id and draft state from the latest row for the week where that field is non-empty.
function latestFor(recs, weekStart) {
  const out = { docId: '', draftId: '', draftState: '' };
  const keys = { docId: 'doc_id', draftId: 'draft_id', draftState: 'draft_state' };
  for (const r of recs) {
    if (r.week_start !== weekStart) continue;
    for (const [k, col] of Object.entries(keys)) if (r[col]) out[k] = r[col];
  }
  return out;
}

const inRange = (iso, startUtc, endUtc) => { const t = Date.parse(iso); return t >= Date.parse(startUtc) && t < Date.parse(endUtc); };
function callsInCalendarWeek(recs, startUtc, endUtc) {
  return recs.filter((r) => inRange(r.run_at, startUtc, endUtc)).reduce((a, r) => a + (Number(r.model_calls) || 0), 0);
}
function spentInCalendarWeek(recs, startUtc, endUtc) {
  return recs.filter((r) => inRange(r.run_at, startUtc, endUtc)).reduce((a, r) => a + (Number(r.cost_usd) || 0), 0);
}

// The Sheets API append request (built, never sent here). Append-only: INSERT_ROWS, never an update.
function appendCall(cfg, row) {
  return {
    method: 'POST',
    url: `https://sheets.googleapis.com/v4/spreadsheets/${cfg.ledgerSheetId}/values/${encodeURIComponent(`${cfg.ledgerTab}!A1:P1`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    body: { values: [row] },
  };
}

module.exports = { COLUMNS, STATUS, REASONS, DRAFT_STATES, buildRow, records, latestFor, callsInCalendarWeek, spentInCalendarWeek, appendCall };
