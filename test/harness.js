'use strict';
// Runs the Code-node steps in order against a golden week, with in-memory fakes for HubSpot, Sheets, Drive,
// Gmail and the model (recorded stand-ins, NOT model output). Nothing here touches a network.
const fs = require('fs');
const path = require('path');
const steps = require('../src/steps');
const hubspot = require('../src/hubspot');
const { loadPrompts } = require('../scripts/prompts');

const ROOT = path.join(__dirname, '..');
const FIX = path.join(ROOT, 'fixtures');
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(FIX, rel), 'utf8'));
const exists = (rel) => fs.existsSync(path.join(FIX, rel));
const PROMPTS = loadPrompts(ROOT);
const RULES = JSON.parse(fs.readFileSync(path.join(ROOT, 'rules', 'stale.json'), 'utf8'));
const baseCfg = readJson('test-config.json');

const loadWeek = (id) => readJson(`weeks/${id}.json`);
const loadExpected = (id) => readJson(`expected/${id}.json`);
const loadRecorded = (id) => (exists(`recorded/${id}.json`) ? readJson(`recorded/${id}.json`) : null);
const loadVariant = (id) => readJson(`recorded/variants/${id}.json`);

// opts: { cfg: overrides, recorded, ledger (values), goneDrafts: [ids], modelError, runAt }
function runWeek(id, opts = {}) {
  const wk = loadWeek(id);
  const cfg = { ...baseCfg, ...(wk.hubspotMaxPages ? { hubspotMaxPages: wk.hubspotMaxPages } : {}), ...(opts.cfg || {}) };
  const recorded = opts.recorded !== undefined ? opts.recorded : loadRecorded(id);
  const ledgerValues = opts.ledger || wk.ledger;
  const runAtIso = opts.runAt || wk.runAt;
  const calls = [];
  let nextDoc = 1;
  let nextDraft = 1;

  const p = steps.plan({ cfg, runAtIso, ledgerValues });
  if ((wk.hubspotFailures || 0) >= 3) { // Phase 1: the fake reports the final failure; retries are a Phase 2 node setting
    calls.push({ api: 'hubspot', method: 'GET', object: 'deals', failed: true });
    const errorRow = steps.errorRow({ runAtIso, runId: p.runId, node: 'Read HubSpot deals', reason: 'hubspot_error' });
    const ledgerRow = steps.record({ cfg, plan: p, computed: null, status: 'failed', reason: 'hubspot_error' });
    return { outcome: 'failed', reason: 'hubspot_error', flags: [], facts: null, docHtml: null, doc: null, draft: null, ledgerRow, errorRow, calls, modelCalls: 0, plan: p, ledgerAfter: [...ledgerValues, ledgerRow.map(String)] };
  }

  const raw = { truncated: { readCounts: {} } };
  for (const obj of ['deals', 'contacts', 'tasks']) {
    calls.push({ api: 'hubspot', method: 'GET', object: obj });
    const r = hubspot.collectPages(wk[obj], cfg.hubspotMaxPages);
    raw[obj] = r.records;
    raw.truncated[obj] = r.truncated;
    raw.truncated.readCounts[obj] = r.records.length;
  }
  calls.push({ api: 'sheets', method: 'GET', range: 'weekly' }, { api: 'sheets', method: 'GET', range: 'definitions' });
  const norm = steps.normalise({ cfg, plan: p, hubspotRaw: raw, sheetValues: { weekly: wk.sheet, definitions: wk.definitions } });
  const computed = steps.compute({ cfg, plan: p, norm, rules: RULES, prompts: PROMPTS });

  let modelCalls = 0;
  let toolInput = null;
  let usage = null;
  if (computed.modelNeeded) {
    calls.push({ api: 'anthropic', method: 'POST', body: computed.request.body });
    modelCalls = 1;
    if (!opts.modelError) {
      if (!recorded) throw new Error(`${id}: a model call was made but there is no recorded stand-in`);
      toolInput = recorded.input;
      usage = { input_tokens: computed.request.estimatedInputTokens, output_tokens: recorded.usage.output_tokens };
    }
  }
  const reviewed = steps.review({ computed, toolInput, modelError: !!opts.modelError });
  const rendered = steps.render({ cfg, plan: p, computed, reviewed });

  let docId;
  let docAction;
  if (p.prior.docId) { docId = p.prior.docId; docAction = 'update'; calls.push({ api: 'drive', method: 'PATCH', docId }); } else { docId = `doc-${nextDoc++}`; docAction = 'create'; calls.push({ api: 'drive', method: 'POST' }); }
  const docLink = `https://docs.google.com/document/d/${docId}/edit`;

  let draftId = p.prior.draftId;
  let draftState;
  let draftAction = 'none';
  let reason = reviewed.reason;
  const mail = steps.draft({ cfg, plan: p, computed, rendered, docLink });
  if (p.prior.draftState === 'gone') draftState = 'gone';
  else if (mail.skip) { draftState = 'skipped'; if (!reason) reason = mail.skip; }
  else if (draftId) {
    calls.push({ api: 'gmail', method: 'PUT', path: `drafts/${draftId}` });
    if ((opts.goneDrafts || []).includes(draftId)) draftState = 'gone'; else { draftState = 'updated'; draftAction = 'update'; }
  } else {
    draftId = `draft-${nextDraft++}`;
    calls.push({ api: 'gmail', method: 'POST', path: 'drafts' });
    draftState = 'created'; draftAction = 'create';
  }
  const ledgerRow = steps.record({ cfg, plan: p, computed, status: reviewed.status, reason, docId, draftId: draftId || '', draftState, modelCalls, usage, runtimeS: 1 });
  calls.push({ api: 'sheets', method: 'POST', range: 'runs (append)' });
  return {
    outcome: reviewed.status, reason, check: reviewed.check, flags: computed.flags, facts: computed.facts, computed, reviewed,
    docHtml: rendered.html, doc: { id: docId, action: docAction, title: rendered.title, headline: rendered.headline },
    draft: mail.skip ? null : { id: draftId, action: draftAction, state: draftState, ...mail }, draftState,
    ledgerRow, errorRow: null, calls, modelCalls, plan: p, ledgerAfter: [...ledgerValues, ledgerRow.map(String)],
  };
}

module.exports = { ROOT, FIX, PROMPTS, RULES, baseCfg, readJson, loadWeek, loadExpected, loadRecorded, loadVariant, runWeek };
