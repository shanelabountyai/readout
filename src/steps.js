'use strict';
// One function per Code node (PHASE-1-PLAN "steps.js"). Pure: everything a step needs is passed in, including
// the run time. test/harness.js runs them in order against a golden week with in-memory fakes.
const week = require('./week');
const hubspot = require('./hubspot');
const sheet = require('./sheet');
const metrics = require('./metrics');
const { compare } = require('./compare');
const flagsMod = require('./flags');
const facts = require('./facts');
const prompt = require('./prompt');
const checks = require('./checks');
const template = require('./template');
const doc = require('./doc');
const email = require('./email');
const ledger = require('./ledger');
const spend = require('./spend');
const num = require('./num');

const runIdFor = (runAtIso) => 'run-' + runAtIso.replace(/[^0-9]/g, '').slice(0, 14);

// Plan: report week, the week's Doc/draft ids from the ledger, the spend precheck.
function plan({ cfg, runAtIso, ledgerValues }) {
  const wk = week.reportWeek(runAtIso, cfg.timezone, cfg.weekStartOverride || '');
  const cal = week.calendarWeekOf(runAtIso, cfg.timezone);
  const recs = ledger.records(ledgerValues);
  const callsThisWeek = ledger.callsInCalendarWeek(recs, cal.startUtc, cal.endUtc);
  const spentThisWeekUsd = ledger.spentInCalendarWeek(recs, cal.startUtc, cal.endUtc);
  return {
    runId: runIdFor(runAtIso), runAt: runAtIso, week: wk, calendarWeek: cal,
    prior: ledger.latestFor(recs, wk.weekStart), callsThisWeek, spentThisWeekUsd,
    precheck: spend.precheck({ callsThisWeek, spentThisWeekUsd, cfg }),
  };
}

// Normalise: HubSpot pages and sheet values into plain records.
function normalise({ cfg, plan: p, hubspotRaw, sheetValues }) {
  const records = hubspot.normalise(hubspotRaw, cfg, hubspotRaw.truncated || {});
  const sh = sheet.read(sheetValues.weekly, sheetValues.definitions, p.week.window);
  return { records, sheet: sh };
}

// Compute: metrics, comparisons, flags, facts, quiet decision, the model request and the full spend gate.
function compute({ cfg, plan: p, norm, rules, prompts }) {
  const m = metrics.compute(norm.records, p.week.window, cfg, rules);
  const series = { ...m.series, ...norm.sheet.series };
  const metricsList = facts.historyMetrics(cfg, norm.sheet.defs);
  const comparisons = Object.fromEntries(metricsList.map((x) => [x.key, compare(series[x.key])]));
  const flags = flagsMod.compute({
    comparisons, snapshot: m.snapshot, sheetIssues: norm.sheet.issues, metricsList, thresholds: cfg.thresholds,
    skipped: norm.records.skipped, truncated: norm.records.truncated, readCounts: norm.records.readCounts,
  });
  const factList = facts.build(metricsList, comparisons, m.snapshot);
  const quiet = flags.some((f) => f.code === 'quiet_week');
  let request = null;
  let gate = { allowed: false, reason: '' };
  if (!quiet) {
    request = prompt.build({ facts: factList, flags, stalled: m.snapshot.stalled, weekStart: p.week.weekStart, cfg, prompts });
    gate = spend.gate({ callsThisWeek: p.callsThisWeek, estimatedInputTokens: request.estimatedInputTokens, spentThisWeekUsd: p.spentThisWeekUsd, cfg });
  }
  return {
    series, metricsList, comparisons, snapshot: m.snapshot, notes: m.notes, flags, facts: factList, quiet,
    stalledNames: m.snapshot.stalled.map((s) => s.name), request, gate, modelNeeded: !quiet && gate.allowed,
    promptVersion: prompt.versionOf(prompts.text),
  };
}

// Review: the quiet template, a withheld page, or the model's narrative after schema + checks.
function review({ computed, toolInput = null, modelError = false }) {
  if (computed.quiet) {
    const n = template.quietNarrative(computed.facts);
    const c = checks.check(n, computed.facts, computed.stalledNames);
    return c.pass ? { status: 'done', reason: '', narrative: n, check: c, source: 'template' } : { status: 'metrics_only', reason: 'template_check', narrative: null, check: c, source: 'template' };
  }
  if (!computed.gate.allowed) return { status: 'metrics_only', reason: computed.gate.reason, narrative: null, check: null, source: 'none' };
  if (modelError) return { status: 'metrics_only', reason: 'model_error', narrative: null, check: null, source: 'model' };
  const c = checks.check(toolInput, computed.facts, computed.stalledNames);
  return c.pass ? { status: 'done', reason: '', narrative: toolInput, check: c, source: 'model' } : { status: 'metrics_only', reason: c.reason, narrative: null, check: c, source: 'model' };
}

// Render the Doc. On a non-pass path `narrative` is null and no model string reaches the page.
function render({ cfg, plan: p, computed, reviewed }) {
  return doc.render({
    cfg, weekStart: p.week.weekStart, facts: computed.facts, flags: computed.flags, metricsList: computed.metricsList,
    snapshot: computed.snapshot, notes: computed.notes, narrative: reviewed.narrative, withheldReason: reviewed.reason,
  });
}

// The draft, once the Doc link is known.
function draft({ cfg, plan: p, computed, rendered, docLink }) {
  return email.build({ cfg, weekStart: p.week.weekStart, facts: computed.facts, flags: computed.flags, headline: rendered.headline, docLink });
}

// The ledger row. Throws (ledger.buildRow) on anything that is not an id, code, count, cost or timestamp.
function record({ cfg, plan: p, computed, status, reason, docId = '', draftId = '', draftState = '', modelCalls = 0, usage = null, runtimeS = 0 }) {
  const cost = spend.costUsd(usage, cfg);
  return ledger.buildRow({
    run_id: p.runId, week_start: p.week.weekStart, status, reason,
    flags: computed ? [...new Set(computed.flags.map((f) => f.code))].join('|') : '',
    doc_id: docId, draft_id: draftId, draft_state: draftState,
    prompt_version: computed && modelCalls ? computed.promptVersion : '', model: modelCalls ? cfg.model : '',
    model_calls: modelCalls, input_tokens: (usage && usage.input_tokens) || 0, output_tokens: (usage && usage.output_tokens) || 0,
    cost_usd: cost === null ? '' : num.renderUsdCost(cost), runtime_s: runtimeS, run_at: p.runAt,
  });
}

// An `errors` tab row: when, which run, which node, a reason code. No business data, no message text.
const ERROR_REASONS = ['hubspot_error', 'sheet_error', 'drive_error', 'gmail_error', 'model_error', 'unknown_error'];
function errorRow({ runAtIso, runId, node, reason }) {
  if (!/^[A-Za-z0-9 /_-]{1,60}$/.test(node)) throw new Error('errorRow: bad node name');
  if (!ERROR_REASONS.includes(reason)) throw new Error('errorRow: bad reason');
  return [runAtIso, runId || '', node, reason];
}

module.exports = { plan, normalise, compute, review, render, draft, record, errorRow, ERROR_REASONS, runIdFor };
