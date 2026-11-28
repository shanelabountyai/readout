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
const mime = require('./mime');

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

// ---------------- Phase 2: the wiring steps (each one Code node in workflow.json)

// An n8n item from an HTTP node that failed after its tries, with "On Error: Continue" (D-071).
const isError = (json) => !json || !!json.error;

// Normalise, first part: the first source read that failed, in workflow order, or null. `reads` is a list of
// [node name, first item json, reason]. A missing sheet ROW is not a failure (D-014); a failed read is.
function sourceFailure(reads) {
  for (const [node, json, reason] of reads) if (isError(json)) return { reason, node };
  return null;
}

// Render, second part: the two Drive upload bodies (create into the Pulse folder; update by id keeps parents).
function docBodies({ cfg, rendered }) {
  return {
    contentType: mime.MULTIPART_TYPE,
    create: mime.multipart({ name: rendered.title, mimeType: 'application/vnd.google-apps.document', parents: [cfg.pulseFolderId] }, rendered.html),
    update: mime.multipart({ name: rendered.title }, rendered.html),
  };
}

const ok2xx = (code) => Number.isInteger(code) && code >= 200 && code < 300;

// Which Doc this run wrote. `updated` is the full response of `PATCH files/{id}` (Never Error on), `created`
// the body of the create upload; a 404 on update means the Doc was deleted and it is recreated (D-017).
function docOutcome({ priorDocId, updated = null, created = null }) {
  if (created) {
    if (isError(created) || !created.id) return { ok: false, docId: '', failure: { reason: 'drive_error', node: 'Create Doc' } };
    return { ok: true, docId: String(created.id), action: updated ? 'recreate' : 'create' };
  }
  if (updated && !isError(updated) && ok2xx(updated.statusCode)) return { ok: true, docId: priorDocId, action: 'update' };
  return { ok: false, docId: '', failure: { reason: 'drive_error', node: 'Update Doc' } };
}

// Draft: the mail, the action, and for an update the RFC 822 message (D-017: update by PUT drafts/{id}).
function draftAction({ cfg, plan: p, computed, rendered, docId }) {
  const mail = draft({ cfg, plan: p, computed, rendered, docLink: `https://docs.google.com/document/d/${docId}/edit` });
  const action = p.prior.draftState === 'gone' ? 'gone' : mail.skip ? 'skip' : p.prior.draftId ? 'update' : 'create';
  const out = { ...mail, docId, action, draftId: p.prior.draftId };
  if (action === 'update') out.raw = mime.rawMessage({ to: mail.to, subject: mail.subject, body: mail.body });
  return out;
}

// Record: the run's ledger row and, when something failed, its `errors` row. Every path of the main
// execution ends here. failure: { reason, node } from a source read or the Drive write; mail: the Draft
// node's output (absent on a failure before it); created / updated: the Gmail node output / the PUT's full response.
function finish({ cfg, plan: p, computed = null, reviewed = null, failure = null, docId = '', mail = null, created = null, updated = null, usage = null, modelCalls = 0, runtimeS = 0 }) {
  let status = reviewed ? reviewed.status : 'failed';
  let reason = reviewed ? reviewed.reason : '';
  let draftId = '';
  let draftState = '';
  let err = failure;
  if (failure) { status = 'failed'; reason = failure.reason; docId = failure.reason === 'drive_error' ? '' : docId; }
  else if (mail) {
    draftId = mail.draftId || '';
    if (mail.action === 'gone') draftState = 'gone';
    else if (mail.action === 'skip') { draftState = 'skipped'; if (!reason) reason = mail.skip; }
    else if (mail.action === 'update') {
      if (updated && !isError(updated) && ok2xx(updated.statusCode)) draftState = 'updated';
      else if (updated && !isError(updated) && updated.statusCode === 404) draftState = 'gone'; // sent or deleted by the owner: not recreated
      else err = { reason: 'gmail_error', node: 'Update draft' };
    } else if (created && !isError(created) && created.id) { draftId = String(created.id); draftState = 'created'; }
    else err = { reason: 'gmail_error', node: 'Create draft' };
    if (err) { status = 'failed'; reason = 'gmail_error'; }
  }
  const row = record({ cfg, plan: p, computed, status, reason, docId, draftId, draftState, modelCalls, usage: usage && Number.isInteger(usage.input_tokens) && Number.isInteger(usage.output_tokens) ? usage : null, runtimeS });
  return { row, errorRow: err ? errorRow({ runAtIso: p.runAt, runId: p.runId, node: err.node, reason: err.reason }) : null };
}

// The Error Trigger execution (a crash the main path did not catch): it has config (the trigger feeds the
// `config` node, D-073) but not the failed run's nodes, so its run id and week come from the error time.
function errorReasonFor(node) {
  if (/HubSpot/.test(node)) return 'hubspot_error';
  if (/sheet|ledger|definitions|error row/i.test(node)) return 'sheet_error';
  if (/Doc/.test(node)) return 'drive_error';
  if (/draft/i.test(node)) return 'gmail_error';
  if (/Anthropic/.test(node)) return 'model_error';
  return 'unknown_error';
}
function errorRun({ cfg, runAtIso, node }) {
  const p = plan({ cfg, runAtIso, ledgerValues: [] });
  const clean = String(node || '').replace(/[^A-Za-z0-9 /_-]/g, '').slice(0, 60) || 'unknown';
  const reason = errorReasonFor(clean);
  return { row: record({ cfg, plan: p, computed: null, status: 'failed', reason }), errorRow: errorRow({ runAtIso, runId: p.runId, node: clean, reason }) };
}

// After the ledger append: the errors row to write (including a failed append itself) and the optional
// webhook line, at most one per 15 minutes (D-018, D-074). The line carries codes only, never business data.
const ALERT_GAP_MS = 15 * 60 * 1000;
function afterLedger({ cfg, outcome, appendFailed, lastAlertAt = '', nowIso }) {
  let er = outcome.errorRow;
  if (!er && appendFailed) er = errorRow({ runAtIso: outcome.row[15], runId: outcome.row[0], node: 'Append ledger', reason: 'sheet_error' });
  let alert = null;
  let last = lastAlertAt || '';
  if (er && cfg.alertWebhookUrl && (!last || Date.parse(nowIso) - Date.parse(last) >= ALERT_GAP_MS)) {
    alert = { text: `N3 readout: run ${er[1] || '(no id)'} failed at "${er[2]}" (${er[3]}). See the errors tab.` };
    last = nowIso;
  }
  return { errorRow: er, alert, lastAlertAt: last };
}

module.exports = {
  plan, normalise, compute, review, render, draft, record, errorRow, ERROR_REASONS, runIdFor,
  isError, sourceFailure, docBodies, docOutcome, draftAction, finish, errorReasonFor, errorRun, afterLedger, ALERT_GAP_MS,
};
