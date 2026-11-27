'use strict';
// Normalise raw HubSpot list results (GET /crm/v3/objects/{deals|contacts|tasks}) and apply the demo guard
// (D-016). Contact emails and task subjects are dropped after the guard (D-032); deal names stay, because a
// stalled deal is shown by name. Deals outside cfg.pipelineId are dropped and not counted as skipped (D-040).
const num = require('./num');

const DEMO_PREFIX = '[demo]';
const DEMO_TLD = '.example';

function ts(v) {
  if (v === null || v === undefined || v === '') return null;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}
const props = (o) => (o && o.properties) || {};

function isDemoName(s) { return typeof s === 'string' && s.startsWith(DEMO_PREFIX); }
function isDemoEmail(email) {
  if (typeof email !== 'string' || !email.includes('@')) return false;
  const domain = email.slice(email.lastIndexOf('@') + 1).trim().toLowerCase();
  return domain.endsWith(DEMO_TLD);
}

function normaliseDeal(o) {
  const p = props(o);
  const raw = (o.propertiesWithHistory && o.propertiesWithHistory.dealstage) || [];
  const stageHistory = raw.map((h) => ({ value: h.value, at: ts(h.timestamp) })).filter((h) => h.at)
    .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  const amt = p.amount === null || p.amount === undefined || p.amount === '' ? { ok: false } : num.parseDollars(p.amount);
  const createdAt = ts(p.createdate) || ts(o.createdAt);
  const notes = ts(p.notes_last_updated);
  const lastStage = stageHistory.length ? stageHistory[stageHistory.length - 1].at : null;
  const lastActivityAt = notes && lastStage ? (notes > lastStage ? notes : lastStage) : notes || lastStage || createdAt;
  return {
    id: String(o.id), name: p.dealname, stage: p.dealstage, amountCents: amt.ok ? amt.cents : null,
    createdAt, closedAt: ts(p.closedate), lastActivityAt, stageHistory,
  };
}

// raw: { deals: [obj], contacts: [obj], tasks: [obj] }; truncated: { deals, contacts, tasks } booleans plus
// counts of records read (for the hubspot_truncated sentence).
function normalise(raw, cfg, truncated = {}) {
  const skipped = { deals: 0, contacts: 0, tasks: 0 };
  const deals = [];
  for (const o of raw.deals || []) {
    const p = props(o);
    if ((p.pipeline || '') !== cfg.pipelineId) continue;
    if (!isDemoName(p.dealname)) { skipped.deals++; continue; }
    deals.push(normaliseDeal(o));
  }
  const contacts = [];
  for (const o of raw.contacts || []) {
    const p = props(o);
    if (!isDemoEmail(p.email)) { skipped.contacts++; continue; } // includes contacts with no email
    contacts.push({ id: String(o.id), createdAt: ts(p.createdate) || ts(o.createdAt) });
  }
  const tasks = [];
  for (const o of raw.tasks || []) {
    const p = props(o);
    if (!isDemoName(p.hs_task_subject)) { skipped.tasks++; continue; }
    tasks.push({ id: String(o.id), status: p.hs_task_status || '', dueAt: ts(p.hs_timestamp) });
  }
  return {
    deals, contacts, tasks, skipped,
    truncated: { deals: !!truncated.deals, contacts: !!truncated.contacts, tasks: !!truncated.tasks },
    readCounts: truncated.readCounts || { deals: (raw.deals || []).length, contacts: (raw.contacts || []).length, tasks: (raw.tasks || []).length },
  };
}

// Pages as returned by the API → records plus whether the read stopped at maxPages with more to come.
function collectPages(pages, maxPages) {
  const read = (pages || []).slice(0, maxPages);
  const records = read.flatMap((p) => p.results || []);
  const last = read[read.length - 1];
  return { records, truncated: read.length === maxPages && !!(last && last.paging && last.paging.next) };
}

module.exports = { DEMO_PREFIX, DEMO_TLD, isDemoName, isDemoEmail, normalise, normaliseDeal, collectPages };
