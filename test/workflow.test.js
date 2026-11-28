'use strict';
// AC-09 (no send), AC-02 (HubSpot GET only, structural), AC-16 (inactive; config the only account node);
// workflow.json is generated and drift-checked.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const B = require('../scripts/build-workflow');
const H = require('./harness');

const file = path.join(H.ROOT, 'workflow.json');
const text = fs.readFileSync(file, 'utf8');
const wf = JSON.parse(text);
const names = new Set(wf.nodes.map((n) => n.name));
const TRIGGERS = ['n8n-nodes-base.scheduleTrigger', 'n8n-nodes-base.manualTrigger', 'n8n-nodes-base.errorTrigger'];

test('AC-16: ships inactive; successful executions not saved (D-029); valid export with unique names', () => {
  assert.strictEqual(wf.active, false);
  assert.strictEqual(wf.settings.errorWorkflow, undefined, 'set after import (D-073), never an id that changes on import');
  assert.strictEqual(wf.settings.saveDataSuccessExecution, 'none');
  assert.strictEqual(wf.settings.timezone, 'America/Chicago');
  assert.strictEqual(names.size, wf.nodes.length);
  for (const n of wf.nodes) assert.ok(n.name && n.type && typeof n.typeVersion === 'number' && Array.isArray(n.position) && n.parameters, n.name);
  assert.strictEqual(wf.meta.promptVersion, 'narrate-v0.1');
});

test('the planned nodes exist; schedule is Mondays 10:00; every node is reachable from a trigger and has an input', () => {
  for (const n of ['Schedule (Mon 10:00 America/Chicago)', 'Manual', 'config', 'Plan', 'Read ledger', 'Read HubSpot deals', 'Read HubSpot contacts', 'Read HubSpot tasks', 'Read weekly sheet', 'Normalise', 'Compute', 'Model needed?', 'Anthropic', 'Review', 'Render', 'Create Doc', 'Update Doc', 'Create draft', 'Update draft', 'Append ledger', 'Error Trigger', 'Error row',
    'Read definitions', 'Sources ok?', 'Doc gone?', 'Doc written', 'Record', 'Outcome', 'After ledger', 'Append error row', 'Alert webhook']) assert.ok(names.has(n), n);
  assert.deepStrictEqual(wf.nodes.find((n) => n.type === 'n8n-nodes-base.scheduleTrigger').parameters.rule.interval[0], { field: 'weeks', weeksInterval: 1, triggerAtDay: [1], triggerAtHour: 10, triggerAtMinute: 0 });
  const incoming = new Map();
  for (const [from, c] of Object.entries(wf.connections)) {
    assert.ok(names.has(from), from);
    for (const out of c.main) for (const l of out) { assert.ok(names.has(l.node), l.node); incoming.set(l.node, (incoming.get(l.node) || 0) + 1); }
  }
  const triggers = wf.nodes.filter((n) => TRIGGERS.includes(n.type)).map((n) => n.name);
  for (const n of wf.nodes) if (!TRIGGERS.includes(n.type)) assert.ok(incoming.get(n.name), `${n.name} has no input`);
  const seen = new Set(triggers);
  const stack = [...triggers];
  while (stack.length) for (const out of (wf.connections[stack.pop()] || { main: [] }).main) for (const l of out) if (!seen.has(l.node)) { seen.add(l.node); stack.push(l.node); }
  assert.deepStrictEqual(wf.nodes.map((n) => n.name).filter((n) => !seen.has(n)), []);
});

// N7's list, extended. A test that fails if any node can send mail.
function sendProblems(w) {
  const problems = [];
  for (const n of w.nodes) {
    if (/emailSend|smtp|sendGrid|sendgrid|mailgun|mailjet|microsoftOutlook|mandrill|sendInBlue|brevo|postmark|awsSes|\.ses$|imap/i.test(n.type)) problems.push(`${n.name}: mail node type ${n.type}`);
    if (n.type === 'n8n-nodes-base.gmail' && !(n.parameters.resource === 'draft' && n.parameters.operation === 'create')) problems.push(`${n.name}: Gmail ${n.parameters.resource}/${n.parameters.operation}`);
    if (/send|reply|forward/i.test(String(n.parameters.operation || ''))) problems.push(`${n.name}: operation ${n.parameters.operation}`);
    if (n.type === 'n8n-nodes-base.httpRequest') {
      const url = String(n.parameters.url);
      if (/\/send\b|:send|messages\/send|drafts\/send|\/reply\b|\/forward\b/i.test(url)) problems.push(`${n.name}: url ${url}`);
      if (/gmail\.googleapis\.com/.test(url) && n.parameters.method !== 'PUT') problems.push(`${n.name}: the only Gmail HTTP call is PUT drafts/{id}`);
    }
    if (n.type === 'n8n-nodes-base.code' && /messages\/send|drafts\/send|\/send\b/i.test(n.parameters.jsCode)) problems.push(`${n.name}: code mentions a send path`);
  }
  return problems;
}

test('AC-09: no node can send mail — the only Gmail node is draft/create, the only Gmail HTTP call is PUT drafts/{id}', () => {
  assert.deepStrictEqual(sendProblems(wf), []);
  const gmail = wf.nodes.filter((n) => n.type === 'n8n-nodes-base.gmail');
  assert.deepStrictEqual(gmail.map((n) => [n.name, n.parameters.resource, n.parameters.operation]), [['Create draft', 'draft', 'create']]);
  assert.strictEqual(gmail[0].retryOnFail, false, 'a retried create could leave a second draft');
});

test('AC-09: the send check itself catches a send node, a send operation and a /send URL', () => {
  const bad = (mut) => { const w = JSON.parse(text); mut(w); return sendProblems(w).length > 0; };
  assert.ok(bad((w) => { w.nodes.find((n) => n.name === 'Create draft').parameters.operation = 'send'; }));
  assert.ok(bad((w) => { w.nodes.find((n) => n.name === 'Create draft').parameters.resource = 'message'; }));
  assert.ok(bad((w) => { w.nodes.find((n) => n.name === 'Update draft').parameters.url = 'https://gmail.googleapis.com/gmail/v1/users/me/drafts/send'; }));
  assert.ok(bad((w) => { w.nodes.push({ name: 'x', type: 'n8n-nodes-base.emailSend', parameters: {} }); }));
  assert.ok(bad((w) => { w.nodes.find((n) => n.name === 'Update draft').parameters.method = 'POST'; }));
});

function crmWriteProblems(w) {
  const problems = [];
  for (const n of w.nodes) {
    const p = JSON.stringify(n.parameters);
    if (/hubspot/i.test(n.type) && !['get', 'getAll', 'search'].includes(n.parameters.operation)) problems.push(`${n.name}: HubSpot node operation ${n.parameters.operation}`);
    if (n.type === 'n8n-nodes-base.httpRequest' && (/api\.hubapi\.com/.test(p) || n.parameters.nodeCredentialType === 'hubspotAppToken') && n.parameters.method !== 'GET') problems.push(`${n.name}: ${n.parameters.method} to HubSpot`);
    if (n.type === 'n8n-nodes-base.code' && /api\.hubapi\.com/.test(n.parameters.jsCode)) problems.push(`${n.name}: code calls HubSpot`);
  }
  return problems;
}

test('AC-02 (structural): every HubSpot call is a GET; no HubSpot node with a write operation', () => {
  assert.deepStrictEqual(crmWriteProblems(wf), []);
  const hub = wf.nodes.filter((n) => n.parameters.nodeCredentialType === 'hubspotAppToken');
  assert.deepStrictEqual(hub.map((n) => [n.name, n.parameters.method]), [['Read HubSpot deals', 'GET'], ['Read HubSpot contacts', 'GET'], ['Read HubSpot tasks', 'GET']]);
  const w = JSON.parse(text);
  w.nodes.find((n) => n.name === 'Read HubSpot deals').parameters.method = 'PATCH';
  assert.ok(crmWriteProblems(w).length > 0, 'the check catches a write');
});

test('AC-16: config is the only account node — no REPLACE_WITH_, email address or Drive/Sheets id elsewhere', () => {
  const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/;
  const GOOGLE_ID = /\b1[A-Za-z0-9_-]{32,}\b|[A-Za-z0-9_-]{40,}/;
  const holders = wf.nodes.filter((n) => JSON.stringify(n.parameters).includes('REPLACE_WITH_')).map((n) => n.name);
  assert.deepStrictEqual(holders, ['config']);
  for (const n of wf.nodes.filter((x) => x.name !== 'config')) {
    const p = JSON.stringify(n.parameters);
    assert.doesNotMatch(p, EMAIL, `${n.name} holds an email address`);
    assert.doesNotMatch(p, GOOGLE_ID, `${n.name} holds an id-like string`);
    if (n.type !== 'n8n-nodes-base.code') assert.doesNotMatch(p, /\.example/, `${n.name} names the demo TLD`);
  }
  const tpl = require('../config/config.template.json');
  for (const k of Object.keys(tpl)) assert.ok(wf.nodes.find((n) => n.name === 'config').parameters.jsCode.includes(`"${k}"`), k);
});

test('credentials: four named placeholders (D-021), mapped on import; nothing secret-looking', () => {
  const creds = new Map();
  for (const n of wf.nodes) for (const [type, c] of Object.entries(n.credentials || {})) creds.set(c.name, { type, id: c.id });
  assert.deepStrictEqual([...creds.keys()].sort(), ['anthropic-lab', 'gmail-lab', 'google-drive-lab', 'hubspot-demo-readonly']);
  for (const { id } of creds.values()) assert.match(id, /^map-on-import-/);
  assert.doesNotMatch(text, /sk-ant-|pat-na1-|AIza[0-9A-Za-z_-]{20}|ya29\.|xox[bp]-/);
});

test('Code nodes inline the current src/ modules, prompt and rules; every Code node compiles', () => {
  for (const n of wf.nodes.filter((x) => x.type === 'n8n-nodes-base.code')) {
    assert.doesNotThrow(() => new Function('$', '$input', 'require', `return (async function () {\n${n.parameters.jsCode}\n});`), n.name);
    if (n.name === 'config' || n.name === 'Outcome') continue; // the two Code nodes without the library (Outcome only passes its input on)
    for (const m of B.MODULES) assert.ok(n.parameters.jsCode.includes(fs.readFileSync(path.join(H.ROOT, 'src', `${m}.js`), 'utf8')), `${n.name} lacks current src/${m}.js`);
    assert.ok(n.parameters.jsCode.includes(JSON.stringify(H.PROMPTS.text)), `${n.name} lacks the current prompt`);
  }
  assert.deepStrictEqual(B.MODULES.slice().sort(), fs.readdirSync(path.join(H.ROOT, 'src')).filter((f) => f.endsWith('.js')).map((f) => f.replace('.js', '')).sort(), 'every src module is bundled');
});

test('the inlined bundle runs: the Compute node\'s library reproduces E01\'s facts exactly', () => {
  const n = wf.nodes.find((x) => x.name === 'Compute');
  const lib = n.parameters.jsCode.slice(0, n.parameters.jsCode.indexOf("const cfg = $('config')"));
  const bundled = new Function('require', `${lib}\nreturn { M, PROMPTS, RULES };`)(require);
  const wk = H.loadWeek('E01');
  const p = bundled.M.steps.plan({ cfg: H.baseCfg, runAtIso: wk.runAt, ledgerValues: wk.ledger });
  const hubspotRaw = { deals: wk.deals[0].results, contacts: wk.contacts[0].results, tasks: wk.tasks[0].results };
  const norm = bundled.M.steps.normalise({ cfg: H.baseCfg, plan: p, hubspotRaw, sheetValues: { weekly: wk.sheet, definitions: wk.definitions } });
  const out = bundled.M.steps.compute({ cfg: H.baseCfg, plan: p, norm, rules: bundled.RULES, prompts: bundled.PROMPTS });
  assert.deepStrictEqual(out.facts, H.runWeek('E01').facts);
  assert.deepStrictEqual(bundled.RULES, H.RULES);
});

test('drift: workflow.json equals the build output; --check passes now and isCurrent rejects an edit', () => {
  assert.ok(B.isCurrent(text));
  assert.ok(!B.isCurrent(text.replace('"active": false', '"active": true')));
  assert.match(execFileSync(process.execPath, [path.join(H.ROOT, 'scripts', 'build-workflow.js'), '--check'], { encoding: 'utf8' }), /up to date/);
});

// ---------------- Phase 2: node settings (checked against n8n-nodes-base 2.49.8, D-071, D-072)

const node = (n) => wf.nodes.find((x) => x.name === n);
const READS = ['Read ledger', 'Read HubSpot deals', 'Read HubSpot contacts', 'Read HubSpot tasks', 'Read weekly sheet', 'Read definitions'];

test('retries (AC-15): every read tries 3 times then continues to the failure path; creates and the model call are tried once', () => {
  for (const n of [...READS, 'Append ledger', 'Append error row']) {
    assert.deepStrictEqual([node(n).retryOnFail, node(n).maxTries, node(n).onError, node(n).executeOnce], [true, 3, 'continueRegularOutput', true], n);
  }
  for (const n of ['Anthropic', 'Create Doc', 'Update Doc', 'Create draft', 'Update draft', 'Alert webhook']) {
    assert.deepStrictEqual([node(n).retryOnFail, node(n).onError], [false, 'continueRegularOutput'], n);
  }
  for (const n of wf.nodes.filter((x) => x.type === 'n8n-nodes-base.httpRequest' || x.type === 'n8n-nodes-base.gmail')) assert.ok(n.onError, `${n.name} has an error setting`);
});

test('HubSpot reads are paged by the after cursor up to hubspotMaxPages; deals ask for dealstage history at 50 a page (D-072)', () => {
  for (const n of ['Read HubSpot deals', 'Read HubSpot contacts', 'Read HubSpot tasks']) {
    const pg = node(n).parameters.options.pagination.pagination;
    assert.deepStrictEqual([pg.paginationMode, pg.paginationCompleteWhen, pg.limitPagesFetched, pg.maxRequests], ['updateAParameterInEachRequest', 'other', true, require('../config/config.template.json').hubspotMaxPages], n);
    assert.deepStrictEqual(pg.parameters.parameters, [{ type: 'qs', name: 'after', value: '={{ $response.body.paging.next.after }}' }]);
    assert.strictEqual(node(n).parameters.method, 'GET');
  }
  const q = Object.fromEntries(node('Read HubSpot deals').parameters.queryParameters.parameters.map((x) => [x.name, x.value]));
  assert.deepStrictEqual([q.limit, q.propertiesWithHistory, q.archived], ['50', 'dealstage', 'false']);
});

test('Anthropic: POST /v1/messages with anthropic-version, the Compute body, the anthropic-lab credential', () => {
  const a = node('Anthropic').parameters;
  assert.deepStrictEqual([a.method, a.url, a.nodeCredentialType], ['POST', 'https://api.anthropic.com/v1/messages', 'anthropicApi']);
  assert.deepStrictEqual(a.headerParameters.parameters, [{ name: 'anthropic-version', value: '2023-06-01' }]);
});

test('Drive: multipart upload converting to a Google Doc; update by id with Never Error so a 404 recreates (D-017)', () => {
  for (const n of ['Create Doc', 'Update Doc']) {
    assert.strictEqual(node(n).parameters.contentType, 'raw', n);
    assert.match(node(n).parameters.url, /upload\/drive\/v3\/files.*uploadType=multipart/, n);
  }
  assert.deepStrictEqual([node('Create Doc').parameters.method, node('Update Doc').parameters.method], ['POST', 'PATCH']);
  assert.deepStrictEqual(node('Update Doc').parameters.options.response.response, { fullResponse: true, neverError: true });
  assert.deepStrictEqual(wf.connections['Doc gone?'].main.map((o) => o.map((l) => l.node)), [['Create Doc'], ['Doc written']]);
});

test('no node outside config holds a webhook URL; the alert goes only to config.alertWebhookUrl, with no credential', () => {
  const a = node('Alert webhook');
  assert.deepStrictEqual([a.parameters.method, a.parameters.url, a.parameters.authentication, a.credentials], ['POST', "={{ $('config').first().json.alertWebhookUrl }}", 'none', undefined]);
});

// ---------------- Phase 2: workflow.json executed offline by test/n8n-sim.js (exit criterion 2)

const S = require('./simrun');
const sim = require('./n8n-sim');
const FL = require('../src/flags');
const { WEEKS, TRUNCATED } = require('../fixtures/spec');
const mask = (row) => row.map((v, i) => (i === 14 ? '<runtime>' : String(v))); // runtime_s: harness 1, sim clock 0

for (const w of [...WEEKS, TRUNCATED]) {
  test(`n8n-sim ${w.id} (${w.title}): workflow.json reproduces the step harness and the expected file`, async () => {
    const e = H.loadExpected(w.id);
    const h = H.runWeek(w.id);
    const s = await S.runSim(w.id);
    assert.strictEqual(s.ledgerRows.length, 1, 'one ledger row appended');
    const row = s.ledgerRows[0];
    assert.deepStrictEqual(mask(row), mask(h.ledgerRow), 'ledger row equals the harness row');
    assert.strictEqual(row[2], e.outcome, 'outcome');
    assert.strictEqual(row[3], e.reason, 'reason');
    assert.strictEqual(s.modelCalls.length, e.modelCalls, 'model calls');
    assert.strictEqual(row[10], String(e.modelCalls));
    const simFlags = s.out('Compute') ? s.out('Compute').flags.map(FL.label) : [];
    if (e.flags) assert.deepStrictEqual(simFlags, e.flags, 'flags computed inside workflow.json');
    assert.deepStrictEqual(simFlags, h.flags.map(FL.label), 'flags equal the harness');
    assert.strictEqual(row[4], [...new Set(h.flags.map((f) => f.code))].join('|'), 'flags column');
    if (e.check !== undefined && e.check !== null && s.out('Review')) assert.strictEqual(s.out('Review').check.pass ? 'pass' : s.out('Review').check.reason, e.check, 'check');
    if (e.facts) assert.deepStrictEqual(Object.fromEntries(s.out('Compute').facts.map((f) => [f.id, f.rendering])), e.facts, 'facts');
    if (e.flagsInclude) for (const code of e.flagsInclude) assert.ok(s.out('Compute').flags.some((f) => f.code === code), code);
    // the request log: model body is the harness body; Doc and draft as the harness says
    if (e.modelCalls) assert.deepStrictEqual(s.modelCalls[0], h.computed.request.body, 'model request body');
    if (e.outcome === 'failed') {
      assert.deepStrictEqual(s.errorRows, [h.errorRow.map(String)], 'errors row');
      assert.strictEqual(s.env.drive.size, 0, 'no Doc');
      assert.strictEqual(s.env.gmail.size, 0, 'no draft');
      return;
    }
    assert.deepStrictEqual(s.errorRows, [], 'no errors row');
    assert.strictEqual(row[5], h.doc.id, 'doc id');
    assert.strictEqual(s.env.drive.get(h.doc.id).html, h.docHtml, 'the Doc in Drive is the harness page');
    assert.strictEqual(s.env.drive.get(h.doc.id).name, h.doc.title);
    if (h.doc.action === 'create') assert.deepStrictEqual(s.env.drive.get(h.doc.id).parents, ['test-folder-pulse']);
    assert.strictEqual(s.env.drive.size, 1, 'one Doc');
    if (e.docId) assert.deepStrictEqual([row[5], row[6]], [e.docId, e.draftId]);
    if (e.draftState) assert.strictEqual(row[7], e.draftState);
    if (h.draft) {
      const d = S.draftText(s.env.gmail.get(h.draft.id));
      assert.deepStrictEqual([d.to, d.subject, d.body], [h.draft.to, h.draft.subject, h.draft.body], 'draft text equals the harness draft');
      assert.strictEqual(s.env.gmail.size, 1, 'one draft');
    }
    if (e.ledgerRowsForWeek) assert.strictEqual(s.env.sheets['test-sheet-ledger'].runs.slice(1).filter((x) => x[1] === '2026-11-16').length, e.ledgerRowsForWeek);
    if (e.outcome === 'metrics_only') assert.strictEqual(s.out('Review').narrative, null, 'no model text');
  });
}

// AC-02 / AC-10 (request log) and AC-09: across runs of every golden week and the failure runs below, every
// request to api.hubapi.com is a GET and no request touches a send path.
const ALL_LOGS = [];
function checkLog(log) {
  ALL_LOGS.push(...log);
  for (const l of log) {
    if (l.host === 'api.hubapi.com') assert.strictEqual(l.method, 'GET', `${l.method} ${l.path}`);
    assert.doesNotMatch(l.path, /\/send\b|:send|\/reply\b|\/forward\b/, l.path);
    if (l.host === 'gmail.googleapis.com') assert.ok((l.method === 'POST' && l.path === '/gmail/v1/users/me/drafts') || (l.method === 'PUT' && /^\/gmail\/v1\/users\/me\/drafts\/[^/]+$/.test(l.path)), `${l.method} ${l.path}`);
  }
}

test('AC-02, AC-10 (request log): every HubSpot request in all 21 simulated golden weeks is a GET; no send path; Gmail only creates and updates drafts', async () => {
  let hub = 0;
  for (const w of [...WEEKS, TRUNCATED]) {
    const s = await S.runSim(w.id);
    checkLog(s.log);
    hub += s.log.filter((l) => l.host === 'api.hubapi.com').length;
  }
  assert.ok(hub >= 60, 'HubSpot was actually read');
  assert.ok(ALL_LOGS.some((l) => l.host === 'gmail.googleapis.com' && l.method === 'PUT'), 'an update was exercised');
  assert.ok(ALL_LOGS.some((l) => l.host === 'gmail.googleapis.com' && l.method === 'POST'), 'a create was exercised');
});

test('paging: E01-truncated follows the after cursor; with hubspotMaxPages 20 both pages are read and nothing is truncated', async () => {
  const s = await S.runSim('E01-truncated');
  assert.deepStrictEqual(s.log.filter((l) => l.path === '/crm/v3/objects/deals').map((l) => l.query.after || ''), ['', 'page2']);
  assert.ok(s.out('Compute').flags.some((f) => f.code === 'hubspot_truncated'), 'cfg.hubspotMaxPages 1 truncates');
  const all = await S.runSim('E01-truncated', { cfg: { hubspotMaxPages: 20 } });
  assert.ok(!all.out('Compute').flags.some((f) => f.code === 'hubspot_truncated'));
  assert.strictEqual(all.out('Normalise').records.readCounts.deals, 39);
});

async function assertFailed(s, reason, node) {
  checkLog(s.log);
  assert.strictEqual(s.modelCalls.length, 0, 'no model call');
  assert.ok(!s.log.some((l) => /googleapis\.com$/.test(l.host) && /drive|gmail/.test(l.host + l.path)), 'no Doc, no draft request');
  assert.deepStrictEqual([s.env.drive.size, s.env.gmail.size], [0, 0]);
  assert.strictEqual(s.ledgerRows.length, 1);
  assert.deepStrictEqual(s.ledgerRows[0].slice(2, 8), ['failed', reason, '', '', '', '']);
  assert.deepStrictEqual(s.errorRows.map((r) => r.slice(2)), [[node, reason]]);
}

test('AC-15: HubSpot failing 3 times → 3 tries, no model call, no Doc, no draft, an errors row, status failed', async () => {
  const s = await S.runSim('E20');
  assert.strictEqual(s.r.tries.get('Read HubSpot deals'), 3);
  assert.strictEqual(s.log.filter((l) => l.path === '/crm/v3/objects/deals').length, 3, 'three GETs to deals');
  // The other reads still run (reads only, D-071); Normalise then fails the run on the first failed source.
  await assertFailed(s, 'hubspot_error', 'Read HubSpot deals');
});

test('AC-15: HubSpot failing twice then answering is a normal run (the third try succeeds)', async () => {
  const s = await S.runSim('E01', { failures: { hubspot: 2 } });
  assert.strictEqual(s.r.tries.get('Read HubSpot deals'), 3);
  assert.strictEqual(s.ledgerRows[0][2], 'done');
});

test('AC-15: the weekly sheet failing 3 times → sheet_error, failed, nothing written but the two rows', async () => {
  const s = await S.runSim('E01', { failures: { sheets: 3 } });
  assert.strictEqual(s.r.tries.get('Read weekly sheet'), 3);
  await assertFailed(s, 'sheet_error', 'Read weekly sheet');
});

test('AC-15: the ledger read failing 3 times → sheet_error at Read ledger', async () => {
  const s = await S.runSim('E01', { failures: { ledger: 3 } });
  await assertFailed(s, 'sheet_error', 'Read ledger');
});

test('a missing tab (definitions) is sheet_error, not a crash; a missing sheet ROW is not a failure (E03)', async () => {
  const s = await S.runSim('E01', { missingTabs: ['definitions'] });
  await assertFailed(s, 'sheet_error', 'Read definitions');
  const e03 = await S.runSim('E03');
  assert.strictEqual(e03.ledgerRows[0][2], 'done');
});

test('AC-11: a re-run of the week updates the same Doc and draft by id; the created draft id reached the ledger', async () => {
  const first = await S.runSim('E01');
  assert.deepStrictEqual(first.ledgerRows[0].slice(5, 8), ['doc-1', 'draft-1', 'created'], 'created ids recorded');
  const second = await S.runSim('E01', { env: first.env, runAt: '2026-11-23T17:00:00Z' });
  checkLog(second.log);
  assert.deepStrictEqual(second.ledgerRows[0].slice(2, 8), ['done', '', '', 'doc-1', 'draft-1', 'updated']);
  assert.deepStrictEqual([first.env.drive.size, first.env.gmail.size], [1, 1], 'no second Doc or draft');
  assert.ok(second.log.some((l) => l.method === 'PATCH' && l.path === '/upload/drive/v3/files/doc-1'));
  assert.ok(second.log.some((l) => l.method === 'PUT' && l.path === '/gmail/v1/users/me/drafts/draft-1'));
  assert.ok(!second.log.some((l) => l.method === 'POST' && /drafts$|upload\/drive\/v3\/files$/.test(l.path)), 'no create call');
  assert.strictEqual(first.env.sheets['test-sheet-ledger'].runs.length, 3, 'header + 2 rows');
  const d = S.draftText(first.env.gmail.get('draft-1'));
  assert.strictEqual(d.headers['Content-Type'], 'text/plain; charset="UTF-8"');
  assert.strictEqual(d.to, 'owner@tallgrassadvisory.example');
});

test('D-017: a deleted Doc is recreated on the next run; a deleted draft becomes gone and is never recreated', async () => {
  const first = await S.runSim('E01');
  first.env.drive.delete('doc-1');
  first.env.gmail.delete('draft-1');
  const second = await S.runSim('E01', { env: first.env, runAt: '2026-11-23T17:00:00Z' });
  assert.deepStrictEqual(second.ledgerRows[0].slice(2, 8), ['done', '', '', 'doc-2', 'draft-1', 'gone']);
  assert.ok(first.env.drive.has('doc-2'));
  assert.strictEqual(first.env.gmail.size, 0, 'draft not recreated');
  const third = await S.runSim('E01', { env: first.env, runAt: '2026-11-23T18:00:00Z' });
  assert.ok(!third.log.some((l) => l.host === 'gmail.googleapis.com'), 'no Gmail call once gone');
  assert.deepStrictEqual(third.ledgerRows[0].slice(5, 8), ['doc-2', 'draft-1', 'gone']);
});

test('E20 then a re-run: the failed row leaves no Doc id, so the re-run creates the Doc (D-045, D-063)', async () => {
  const first = await S.runSim('E20');
  const second = await S.runSim('E20', { env: first.env, runAt: '2026-11-23T17:00:00Z', recorded: H.loadRecorded('E01') });
  assert.deepStrictEqual(second.ledgerRows[0].slice(2, 8), ['done', '', '', 'doc-1', 'draft-1', 'created']);
});

test('model failure: the Anthropic call fails once (no retry) → metrics_only model_error, Doc and draft still written', async () => {
  const s = await S.runSim('E01', { modelError: true });
  assert.strictEqual(s.r.tries.get('Anthropic'), 1);
  assert.deepStrictEqual(s.ledgerRows[0].slice(2, 4), ['metrics_only', 'model_error']);
  assert.deepStrictEqual(s.ledgerRows[0].slice(10, 13), ['1', '0', '0'], 'one call counted, no usage recorded');
  assert.ok(s.env.drive.get('doc-1').html.includes('Narrative withheld: the model could not be reached.'));
});

test('usage from the model response reaches the ledger (replacing the Phase 1 estimate path)', async () => {
  const s = await S.runSim('E01');
  const usage = s.r.outputs.get('Anthropic')[0].json.usage;
  assert.deepStrictEqual(s.ledgerRows[0].slice(11, 13), [String(usage.input_tokens), String(usage.output_tokens)]);
});

test('Drive failure on create → failed drive_error, no draft, errors row; Gmail create failure → failed gmail_error with the Doc id kept', async () => {
  const d = await S.runSim('E01', { failures: { drive: 1 } });
  checkLog(d.log);
  assert.deepStrictEqual(d.ledgerRows[0].slice(2, 8), ['failed', 'drive_error', '', '', '', '']);
  assert.deepStrictEqual(d.errorRows.map((r) => r.slice(2)), [['Create Doc', 'drive_error']]);
  assert.strictEqual(d.env.gmail.size, 0);
  const g = await S.runSim('E01', { failures: { gmailCreate: 1 } });
  assert.deepStrictEqual(g.ledgerRows[0].slice(2, 8), ['failed', 'gmail_error', '', 'doc-1', '', '']);
  assert.deepStrictEqual(g.errorRows.map((r) => r.slice(2)), [['Create draft', 'gmail_error']]);
  const again = await S.runSim('E01', { env: g.env, runAt: '2026-11-23T17:00:00Z' });
  assert.deepStrictEqual(again.ledgerRows[0].slice(5, 8), ['doc-1', 'draft-1', 'created'], 'the next run updates the Doc and creates the draft');
  assert.strictEqual(g.env.drive.size, 1);
});

test('demo guard on the recipient: a non-.example owner gets no draft and no Gmail call (D-016, D-060)', async () => {
  const s = await S.runSim('E01', { cfg: { ownerEmail: 'owner@tallgrass.test' } });
  assert.ok(!s.log.some((l) => l.host === 'gmail.googleapis.com'));
  assert.deepStrictEqual(s.ledgerRows[0].slice(2, 8), ['done', 'demo_guard_recipient', '', 'doc-1', '', 'skipped']);
});

test('a failed ledger append is logged in the errors tab (sheet_error), never an email', async () => {
  const s = await S.runSim('E01', { failures: { ledgerAppend: 3 } });
  assert.strictEqual(s.ledgerRows.length, 0);
  assert.deepStrictEqual(s.errorRows.map((r) => r.slice(1)), [['run-20261123160000', 'Append ledger', 'sheet_error']]);
});

test('Error Trigger (D-067, D-073): the error execution reads config, writes an errors row and a failed ledger row, and one throttled webhook line', async () => {
  const url = 'https://hooks.example/n3';
  const staticData = {};
  const first = await S.runSim('E01', { trigger: 'Error Trigger', triggerItems: sim.errorTriggerItems(S.WF, 'Render'), cfg: { alertWebhookUrl: url }, alertUrl: url, staticData });
  assert.ok(first.r.order.includes('Error row') && !first.r.order.includes('Read HubSpot deals'));
  assert.deepStrictEqual(first.ledgerRows.map((r) => r.slice(0, 8)), [['run-20261123160000', '2026-11-16', 'failed', 'unknown_error', '', '', '', '']]);
  assert.deepStrictEqual(first.errorRows, [['2026-11-23T16:00:00Z', 'run-20261123160000', 'Render', 'unknown_error']]);
  assert.strictEqual(first.env.alerts.length, 1);
  assert.match(first.env.alerts[0].text, /failed at "Render" \(unknown_error\)/);
  assert.doesNotMatch(first.env.alerts[0].text, /\$|\d{2},\d{3}|@/, 'codes only, no business data');
  const second = await S.runSim('E01', { env: first.env, trigger: 'Error Trigger', triggerItems: sim.errorTriggerItems(S.WF, 'Create Doc'), cfg: { alertWebhookUrl: url }, staticData, runAt: '2026-11-23T16:05:00Z' });
  assert.deepStrictEqual(second.errorRows.map((r) => r[3]), ['drive_error']);
  assert.strictEqual(first.env.alerts.length, 1, 'a second line within 15 minutes is throttled');
  const third = await S.runSim('E01', { env: first.env, trigger: 'Error Trigger', triggerItems: sim.errorTriggerItems(S.WF, 'Read HubSpot tasks'), cfg: { alertWebhookUrl: url }, staticData, runAt: '2026-11-23T16:20:00Z' });
  assert.deepStrictEqual(third.errorRows.map((r) => r[3]), ['hubspot_error']);
  assert.strictEqual(first.env.alerts.length, 2);
  checkLog([...first.log, ...second.log, ...third.log]);
});

test('D-079: an Error Trigger payload without "execution" (a trigger failure) still takes the error path, never a full run', async () => {
  const items = [{ json: { trigger: { error: { message: 'activation failed' }, mode: 'trigger' }, workflow: { id: S.WF.id, name: S.WF.name } } }];
  const s = await S.runSim('E01', { trigger: 'Error Trigger', triggerItems: items });
  assert.ok(!s.r.order.includes('Read ledger') && !s.r.order.includes('Read HubSpot deals'));
  assert.deepStrictEqual(s.errorRows.map((r) => r.slice(2)), [['trigger', 'unknown_error']]);
  assert.strictEqual(s.modelCalls.length, 0);
});

test('no alert webhook configured: errors go to the errors tab only', async () => {
  const s = await S.runSim('E20');
  assert.ok(!s.r.order.includes('Alert webhook'));
  assert.strictEqual(s.errorRows.length, 1);
});

test('the simulator itself refuses what it does not model and has no send endpoint', () => {
  const env = sim.makeEnv(H.loadWeek('E01'), H.baseCfg);
  assert.throws(() => sim.request(env, { method: 'GET', url: 'https://example.org/x' }), /no fake/);
  assert.throws(() => sim.request(env, { method: 'POST', url: 'https://gmail.googleapis.com/gmail/v1/users/me/drafts/send', body: {} }), /no fake/);
  assert.strictEqual(sim.request(env, { method: 'POST', url: 'https://api.hubapi.com/crm/v3/objects/notes', body: {} }).statusCode, 405);
});
