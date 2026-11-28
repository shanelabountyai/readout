'use strict';
// Runs one golden week through workflow.json itself (test/n8n-sim.js) with the same inputs the step harness
// uses: the week's fixture as fake HubSpot pages and sheet tabs, the recorded stand-in (hand-written, NOT model
// output) as the fake model's tool input, prior Doc / draft ids from the week's ledger seeded in the fakes.
const fs = require('fs');
const path = require('path');
const sim = require('./n8n-sim');
const H = require('./harness');
const ledger = require('../src/ledger');

const WF = JSON.parse(fs.readFileSync(path.join(H.ROOT, 'workflow.json'), 'utf8'));

// workflow.json with the test config in the `config` node (N7's pattern); everything else as exported.
function testWorkflow(cfgOverrides = {}) {
  const w = JSON.parse(JSON.stringify(WF));
  const c = w.nodes.find((n) => n.name === 'config');
  const cfg = { ...H.baseCfg, ...cfgOverrides };
  const before = c.parameters.jsCode;
  c.parameters.jsCode = before.replace(/const cfg = \{[\s\S]*?\n\};/, `const cfg = ${JSON.stringify(cfg)};`);
  if (c.parameters.jsCode === before) throw new Error('simrun: config block not found');
  return { w, cfg };
}

// The fake model: answers a Messages API request with the recorded stand-in as a write_pulse tool call.
// Usage: input = the same characters/4 estimate the harness uses; output = the stand-in's stated count.
function recordedModel(recorded, calls) {
  return (body) => {
    calls.push(body);
    if (!recorded) return { statusCode: 500, body: { type: 'error', error: { type: 'api_error', message: 'no stand-in' } } };
    return {
      statusCode: 200,
      body: {
        id: 'msg_sim', type: 'message', role: 'assistant', model: body.model, stop_reason: 'tool_use',
        content: [{ type: 'tool_use', id: 'toolu_sim', name: 'write_pulse', input: JSON.parse(JSON.stringify(recorded.input)) }],
        usage: { input_tokens: Math.ceil(JSON.stringify(body).length / 4), output_tokens: recorded.usage.output_tokens },
      },
    };
  };
}

// opts: { cfg, failures, missingTabs, modelError, env (reuse for a re-run), runAt, alertUrl, staticData, trigger, triggerItems, ledger }
async function runSim(id, opts = {}) {
  const wk = H.loadWeek(id);
  const { w, cfg } = testWorkflow({ ...(wk.hubspotMaxPages ? { hubspotMaxPages: wk.hubspotMaxPages } : {}), ...(opts.cfg || {}) });
  const modelCalls = [];
  let env = opts.env;
  if (!env) {
    const fx = { ...wk, ledger: opts.ledger || wk.ledger, hubspot: undefined };
    const prior = ledger.latestFor(ledger.records(fx.ledger), '2026-11-16');
    env = sim.makeEnv(fx, cfg, {
      failures: { hubspot: wk.hubspotFailures || 0, ...(opts.failures || {}) },
      missingTabs: opts.missingTabs, alertUrl: opts.alertUrl,
      docs: prior.docId ? [prior.docId] : [], drafts: prior.draftId && prior.draftState !== 'gone' ? [prior.draftId] : [],
    });
  } else if (opts.failures) Object.assign(env.fail, opts.failures);
  env.model = recordedModel(opts.modelError ? null : (opts.recorded !== undefined ? opts.recorded : H.loadRecorded(id)), modelCalls);
  const runsBefore = env.sheets[cfg.ledgerSheetId][cfg.ledgerTab].length;
  const errorsBefore = env.sheets[cfg.ledgerSheetId][cfg.errorsTab].length;
  const logBefore = env.log.length;
  const r = await sim.run(w, opts.trigger || 'Manual', env, { now: opts.runAt || wk.runAt, staticData: opts.staticData, triggerItems: opts.triggerItems });
  const runs = env.sheets[cfg.ledgerSheetId][cfg.ledgerTab];
  const errs = env.sheets[cfg.ledgerSheetId][cfg.errorsTab];
  return {
    r, env, cfg, w, modelCalls,
    ledgerRows: runs.slice(runsBefore), errorRows: errs.slice(errorsBefore), log: env.log.slice(logBefore),
    out: (n) => (r.outputs.get(n) ? r.outputs.get(n)[0].json : undefined),
  };
}

// Draft text as the owner would see it: decoded from the stored raw message, or the Gmail node's fields.
function draftText(d) {
  if (!d) return null;
  if (!d.raw) return { to: d.to, subject: d.subject, body: d.body };
  const msg = Buffer.from(d.raw, 'base64url').toString('utf8');
  const [head, b64] = msg.split('\r\n\r\n');
  const hdr = Object.fromEntries(head.split('\r\n').map((l) => [l.slice(0, l.indexOf(':')), l.slice(l.indexOf(':') + 2)]));
  const subj = hdr.Subject.startsWith('=?UTF-8?B?') ? Buffer.from(hdr.Subject.slice(10, -2), 'base64').toString('utf8') : hdr.Subject;
  return { to: hdr.To, subject: subj, body: Buffer.from(b64.replace(/\r\n/g, ''), 'base64').toString('utf8').replace(/\r\n/g, '\n'), headers: hdr };
}

module.exports = { WF, testWorkflow, recordedModel, runSim, draftText };
