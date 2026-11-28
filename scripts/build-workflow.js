'use strict';
// Generates workflow.json (the n8n export) from src/*.js, prompts/, rules/ and config/config.template.json.
// Code nodes inline the tested src/ modules (N7's bundle pattern), so the workflow runs exactly the code the
// tests run; test/n8n-sim.js executes this file against in-memory fakes. External node parameters follow the
// node source of n8n-nodes-base 2.49.8 (D-072). Never hand-edit workflow.json; `npm run check` catches drift.
// Usage: node scripts/build-workflow.js           (write workflow.json)
//        node scripts/build-workflow.js --check   (exit 1 if workflow.json is out of date)
const fs = require('fs');
const path = require('path');
const { loadPrompts } = require('./prompts');

const ROOT = path.join(__dirname, '..');
const WORKFLOW_ID = 'n3WeeklyBusinessPulse';
const MODULES = ['num', 'week', 'hubspot', 'sheet', 'metrics', 'compare', 'flags', 'facts', 'prompt', 'schema', 'checks', 'template', 'doc', 'email', 'ledger', 'spend', 'mime', 'steps'];
// Node settings (D-071): reads try 3 times, then continue with an error item that the next Code node routes
// to a failed run; writes that could duplicate (Create Doc, Create draft, the model call) are tried once.
const READ = { retryOnFail: true, maxTries: 3, waitBetweenTries: 3000, onError: 'continueRegularOutput', executeOnce: true };
const ONCE = { retryOnFail: false, onError: 'continueRegularOutput', executeOnce: true };
const ANTHROPIC_VERSION = '2023-06-01';

// Credentials (D-021): names only; ids are placeholders n8n asks you to map on import.
const CRED = {
  drive: { googleDriveOAuth2Api: { id: 'map-on-import-google-drive-lab', name: 'google-drive-lab' } },
  gmail: { gmailOAuth2: { id: 'map-on-import-gmail-lab', name: 'gmail-lab' } },
  hubspot: { hubspotAppToken: { id: 'map-on-import-hubspot-demo-readonly', name: 'hubspot-demo-readonly' } },
  anthropic: { anthropicApi: { id: 'map-on-import-anthropic-lab', name: 'anthropic-lab' } },
};
const CRED_TYPE = { drive: 'googleDriveOAuth2Api', gmail: 'gmailOAuth2', hubspot: 'hubspotAppToken', anthropic: 'anthropicApi' };

function bundle() {
  let out = 'const __nodeRequire = require;\nconst __lib = {};\n';
  out += "const __load = (name, fn) => { const module = { exports: {} }; fn(module, module.exports, (p) => (p.startsWith('./') ? __lib[p] : __nodeRequire(p))); __lib['./' + name] = module.exports; };\n";
  for (const m of MODULES) out += `__load('${m}', function (module, exports, require) {\n${fs.readFileSync(path.join(ROOT, 'src', `${m}.js`), 'utf8')}\n});\n`;
  return out + "const M = { steps: __lib['./steps'], prompt: __lib['./prompt'], hubspot: __lib['./hubspot'] };\n";
}

function build() {
  const prompts = loadPrompts(ROOT);
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'config.template.json'), 'utf8'));
  const rules = JSON.parse(fs.readFileSync(path.join(ROOT, 'rules', 'stale.json'), 'utf8'));
  const LIB = bundle();
  const DATA = `const PROMPTS = ${JSON.stringify(prompts)};\nconst RULES = ${JSON.stringify(rules)};\n`;
  const nodes = [];
  const connections = {};
  const node = (name, type, typeVersion, position, parameters, extra = {}) => { nodes.push({ parameters, name, type, typeVersion, position, ...extra }); return name; };
  const code = (name, position, body, { lib = true } = {}) => node(name, 'n8n-nodes-base.code', 2, position, { jsCode: (lib ? LIB + DATA : '') + body.trim() + '\n' });
  const link = (from, to, out = 0) => {
    connections[from] = connections[from] || { main: [] };
    while (connections[from].main.length <= out) connections[from].main.push([]);
    connections[from].main[out].push({ node: to, type: 'main', index: 0 });
  };
  const chain = (...names) => { for (let i = 1; i < names.length; i++) link(names[i - 1], names[i]); };
  const ifNode = (name, position, expr) => node(name, 'n8n-nodes-base.if', 2.2, position, {
    conditions: {
      options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
      conditions: [{ id: `${name.replace(/\W/g, '')}-c1`, leftValue: expr, rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } }],
      combinator: 'and',
    },
    looseTypeValidation: true, options: {},
  });
  // HTTP Request 4.2 (parameter names checked against n8n-nodes-base 2.49.8, HttpRequest/V3/Description.js).
  const http = (name, position, cred, { method = 'GET', url, query, headers, json, raw, rawType, options = {} } = {}, settings = READ) => {
    const p = { method, url };
    if (cred) Object.assign(p, { authentication: 'predefinedCredentialType', nodeCredentialType: CRED_TYPE[cred] });
    else p.authentication = 'none';
    if (query) { p.sendQuery = true; p.queryParameters = { parameters: Object.entries(query).map(([n, value]) => ({ name: n, value })) }; }
    if (headers) { p.sendHeaders = true; p.headerParameters = { parameters: Object.entries(headers).map(([n, value]) => ({ name: n, value })) }; }
    if (json) { p.sendBody = true; p.specifyBody = 'json'; p.jsonBody = json; }
    if (raw) { p.sendBody = true; p.contentType = 'raw'; p.rawContentType = rawType; p.body = raw; }
    p.options = options;
    return node(name, 'n8n-nodes-base.httpRequest', 4.2, position, p, { ...(cred ? { credentials: CRED[cred] } : {}), ...settings });
  };
  const FULL = { response: { response: { fullResponse: true, neverError: true } } };
  const sheetsGet = (name, position, idKey, tabKey, range) => http(name, position, 'drive', {
    url: `={{ 'https://sheets.googleapis.com/v4/spreadsheets/' + $('config').first().json.${idKey} + '/values/' + encodeURIComponent($('config').first().json.${tabKey} + '!${range}') + '?valueRenderOption=FORMATTED_VALUE' }}`,
  });
  // Paged list read (D-025, D-072): the node follows paging.next.after until a page has none, or Max Pages.
  const hubspotGet = (name, position, object, properties, limit, extraQuery = {}) => http(name, position, 'hubspot', {
    url: `https://api.hubapi.com/crm/v3/objects/${object}`, query: { limit, properties, archived: 'false', ...extraQuery },
    options: {
      pagination: {
        pagination: {
          paginationMode: 'updateAParameterInEachRequest',
          parameters: { parameters: [{ type: 'qs', name: 'after', value: '={{ $response.body.paging.next.after }}' }] },
          paginationCompleteWhen: 'other',
          completeExpression: '={{ !$response.body.paging || !$response.body.paging.next }}',
          limitPagesFetched: true,
          maxRequests: cfg.hubspotMaxPages,
          requestInterval: 100,
        },
      },
    },
  });
  const append = (name, position, tabKey, range, rowExpr, settings) => http(name, position, 'drive', {
    method: 'POST',
    url: `={{ 'https://sheets.googleapis.com/v4/spreadsheets/' + $('config').first().json.ledgerSheetId + '/values/' + encodeURIComponent($('config').first().json.${tabKey} + '!${range}') + ':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS' }}`,
    json: `={{ JSON.stringify({ values: [${rowExpr}] }) }}`,
  }, settings);

  // ---------------- triggers and the only account-specific node
  node('Schedule (Mon 10:00 America/Chicago)', 'n8n-nodes-base.scheduleTrigger', 1.2, [-1600, -100], { rule: { interval: [{ field: 'weeks', weeksInterval: 1, triggerAtDay: [1], triggerAtHour: 10, triggerAtMinute: 0 }] } });
  node('Manual', 'n8n-nodes-base.manualTrigger', 1, [-1600, 100], {});
  node('Error Trigger', 'n8n-nodes-base.errorTrigger', 1, [-1600, 300], {});
  code('config', [-1380, 0], `
// THE ONLY ACCOUNT-SPECIFIC NODE (CLAUDE.md). Fill in the REPLACE_WITH_ values (docs/SETUP.md).
const cfg = ${JSON.stringify(cfg, null, 2)};
// The Error Trigger also feeds this node, so the error path reads the same config (D-073).
// The switch is which trigger ran, not the payload's shape (a trigger failure carries no "execution", D-079).
const t = $input.first().json || {};
const ex = t.execution || {};
const _error = $('Error Trigger').isExecuted ? { node: String(ex.lastNodeExecuted || (t.trigger ? 'trigger' : '')), executionId: String(ex.id || '') } : null;
return [{ json: { ...cfg, _runAt: new Date().toISOString().replace(/\\.\\d{3}Z$/, 'Z'), _error } }];
`, { lib: false });
  link('Schedule (Mon 10:00 America/Chicago)', 'config');
  link('Manual', 'config');
  link('Error Trigger', 'config');
  ifNode('Error run?', [-1160, 0], '={{ !!$json._error }}');
  link('config', 'Error run?');

  // ---------------- plan, read (each read: 3 tries, then an error item), compute
  sheetsGet('Read ledger', [-940, 0], 'ledgerSheetId', 'ledgerTab', 'A:P');
  code('Plan', [-720, 0], `
const cfg = $('config').first().json;
const ledger = $('Read ledger').first().json;
return [{ json: M.steps.plan({ cfg, runAtIso: cfg._runAt, ledgerValues: M.steps.isError(ledger) ? [] : ledger.values || [] }) }];
`);
  hubspotGet('Read HubSpot deals', [-500, 0], 'deals', 'dealname,dealstage,pipeline,amount,createdate,closedate,notes_last_updated', '50', { propertiesWithHistory: 'dealstage' });
  hubspotGet('Read HubSpot contacts', [-280, 0], 'contacts', 'email,createdate', '100');
  hubspotGet('Read HubSpot tasks', [-60, 0], 'tasks', 'hs_task_subject,hs_task_status,hs_timestamp', '100');
  sheetsGet('Read weekly sheet', [160, 0], 'inputSheetId', 'inputTab', 'A:H');
  sheetsGet('Read definitions', [380, 0], 'inputSheetId', 'definitionsTab', 'A:C');
  code('Normalise', [600, 0], `
const cfg = $('config').first().json;
const p = $('Plan').first().json;
const first = (n) => $(n).first().json;
const failure = M.steps.sourceFailure([
  ['Read ledger', first('Read ledger'), 'sheet_error'],
  ['Read HubSpot deals', first('Read HubSpot deals'), 'hubspot_error'],
  ['Read HubSpot contacts', first('Read HubSpot contacts'), 'hubspot_error'],
  ['Read HubSpot tasks', first('Read HubSpot tasks'), 'hubspot_error'],
  ['Read weekly sheet', first('Read weekly sheet'), 'sheet_error'],
  ['Read definitions', first('Read definitions'), 'sheet_error'],
]);
if (failure) return [{ json: { failure } }];
const paged = (n) => M.hubspot.fromPagedRead($(n).all().map((i) => i.json), cfg.hubspotMaxPages);
const d = paged('Read HubSpot deals'); const c = paged('Read HubSpot contacts'); const t = paged('Read HubSpot tasks');
const hubspotRaw = { deals: d.records, contacts: c.records, tasks: t.records,
  truncated: { deals: d.truncated, contacts: c.truncated, tasks: t.truncated, readCounts: { deals: d.records.length, contacts: c.records.length, tasks: t.records.length } } };
const sheetValues = { weekly: first('Read weekly sheet').values || [], definitions: first('Read definitions').values || [] };
return [{ json: { failure: null, ...M.steps.normalise({ cfg, plan: p, hubspotRaw, sheetValues }) } }];
`);
  ifNode('Sources ok?', [820, 0], '={{ !$json.failure }}');
  code('Compute', [1040, -100], `
const cfg = $('config').first().json;
return [{ json: M.steps.compute({ cfg, plan: $('Plan').first().json, norm: $('Normalise').first().json, rules: RULES, prompts: PROMPTS }) }];
`);
  ifNode('Model needed?', [1260, -100], '={{ $json.modelNeeded }}');
  // One call, no retry (D-012, D-062); a failure continues as an error item and becomes model_error.
  http('Anthropic', [1480, -220], 'anthropic', {
    method: 'POST', url: 'https://api.anthropic.com/v1/messages', headers: { 'anthropic-version': ANTHROPIC_VERSION },
    json: "={{ JSON.stringify($('Compute').first().json.request.body) }}",
  }, ONCE);
  code('Review', [1700, -100], `
const computed = $('Compute').first().json;
let toolInput = null; let modelError = false;
if (computed.modelNeeded) {
  const resp = $('Anthropic').first().json;
  modelError = M.steps.isError(resp);
  toolInput = modelError ? null : M.prompt.toolInput(resp);
}
return [{ json: M.steps.review({ computed, toolInput, modelError }) }];
`);
  code('Render', [1920, -100], `
const cfg = $('config').first().json;
const rendered = M.steps.render({ cfg, plan: $('Plan').first().json, computed: $('Compute').first().json, reviewed: $('Review').first().json });
return [{ json: { ...rendered, upload: M.steps.docBodies({ cfg, rendered }) } }];
`);

  // ---------------- the Doc: update by id; a 404 recreates it; else create in the Pulse folder (D-017)
  ifNode('Doc exists?', [2140, -100], "={{ !!$('Plan').first().json.prior.docId }}");
  http('Update Doc', [2360, -220], 'drive', {
    method: 'PATCH', url: "={{ 'https://www.googleapis.com/upload/drive/v3/files/' + $('Plan').first().json.prior.docId + '?uploadType=multipart&supportsAllDrives=true' }}",
    raw: "={{ $('Render').first().json.upload.update }}", rawType: "={{ $('Render').first().json.upload.contentType }}", options: FULL,
  }, ONCE);
  ifNode('Doc gone?', [2580, -220], '={{ $json.statusCode === 404 }}');
  http('Create Doc', [2800, -20], 'drive', {
    method: 'POST', url: 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true',
    raw: "={{ $('Render').first().json.upload.create }}", rawType: "={{ $('Render').first().json.upload.contentType }}",
  }, ONCE);
  code('Doc written', [3020, -100], `
const p = $('Plan').first().json;
const out = M.steps.docOutcome({ priorDocId: p.prior.docId, updated: $('Update Doc').isExecuted ? $('Update Doc').first().json : null, created: $('Create Doc').isExecuted ? $('Create Doc').first().json : null });
return [{ json: out }];
`);
  ifNode('Doc ok?', [3240, -100], '={{ $json.ok }}');

  // ---------------- the draft: update by PUT drafts/{id} (404 = gone, not recreated); else Create draft
  code('Draft', [3460, -200], `
const cfg = $('config').first().json;
return [{ json: M.steps.draftAction({ cfg, plan: $('Plan').first().json, computed: $('Compute').first().json, rendered: $('Render').first().json, docId: $('Doc written').first().json.docId }) }];
`);
  ifNode('Update draft?', [3680, -200], "={{ $json.action === 'update' }}");
  http('Update draft', [3900, -320], 'gmail', {
    method: 'PUT', url: "={{ 'https://gmail.googleapis.com/gmail/v1/users/me/drafts/' + $('Draft').first().json.draftId }}",
    json: "={{ JSON.stringify({ id: $('Draft').first().json.draftId, message: { raw: $('Draft').first().json.raw } }) }}", options: FULL,
  }, ONCE);
  ifNode('Create draft?', [3900, -100], "={{ $json.action === 'create' }}");
  // Gmail 2.1 draft/create (n8n-nodes-base 2.49.8, Google/Gmail/v2). No automatic retry: a create that timed
  // out but succeeded would leave a second draft (N7 D-33).
  node('Create draft', 'n8n-nodes-base.gmail', 2.1, [4120, -100], {
    resource: 'draft', operation: 'create', subject: "={{ $('Draft').first().json.subject }}", emailType: 'text', message: "={{ $('Draft').first().json.body }}",
    options: { sendTo: "={{ $('Draft').first().json.to }}" },
  }, { credentials: CRED.gmail, ...ONCE });

  // ---------------- every main path ends in Record; the error run in Error row; both feed Outcome
  code('Record', [4340, 0], `
const cfg = $('config').first().json;
const ran = (n) => $(n).isExecuted;
const one = (n) => $(n).first().json;
const norm = one('Normalise');
const doc = ran('Doc written') ? one('Doc written') : null;
const computed = ran('Compute') ? one('Compute') : null;
const modelCalls = computed && computed.modelNeeded ? 1 : 0;
const resp = modelCalls ? one('Anthropic') : null;
const out = M.steps.finish({
  cfg, plan: one('Plan'), computed, reviewed: ran('Review') ? one('Review') : null,
  failure: norm.failure || (doc && !doc.ok ? doc.failure : null), docId: doc && doc.ok ? doc.docId : '',
  mail: ran('Draft') ? one('Draft') : null, created: ran('Create draft') ? one('Create draft') : null, updated: ran('Update draft') ? one('Update draft') : null,
  usage: resp && !M.steps.isError(resp) ? resp.usage || null : null, modelCalls,
  runtimeS: Math.max(0, Math.floor((Date.parse(new Date().toISOString()) - Date.parse(cfg._runAt)) / 1000)),
});
return [{ json: out }];
`);
  code('Error row', [-940, 300], `
const cfg = $('config').first().json;
return [{ json: M.steps.errorRun({ cfg, runAtIso: cfg._runAt, node: cfg._error.node }) }];
`);
  code('Outcome', [4560, 100], `
return [{ json: $input.first().json }];
`, { lib: false });
  // The ledger append tries 3 times and then continues, so a failed append is logged in the errors tab.
  append('Append ledger', [4780, 100], 'ledgerTab', 'A1:P1', "$('Outcome').first().json.row", { ...READ, executeOnce: true });
  code('After ledger', [5000, 100], `
const cfg = $('config').first().json;
const sd = $getWorkflowStaticData('global');
const out = M.steps.afterLedger({ cfg, outcome: $('Outcome').first().json, appendFailed: M.steps.isError($input.first().json), lastAlertAt: sd.lastAlertAt || '', nowIso: new Date().toISOString() });
sd.lastAlertAt = out.lastAlertAt;
return [{ json: out }];
`);
  ifNode('Log error?', [5220, 100], '={{ !!$json.errorRow }}');
  append('Append error row', [5440, 0], 'errorsTab', 'A1:D1', "$('After ledger').first().json.errorRow", READ);
  ifNode('Alert?', [5660, 0], "={{ !!$('After ledger').first().json.alert }}");
  // Optional webhook line (D-018): codes only; never an email node.
  http('Alert webhook', [5880, -100], null, {
    method: 'POST', url: "={{ $('config').first().json.alertWebhookUrl }}", json: "={{ JSON.stringify($('After ledger').first().json.alert) }}",
  }, ONCE);

  link('Error run?', 'Error row', 0);
  link('Error run?', 'Read ledger', 1);
  chain('Read ledger', 'Plan', 'Read HubSpot deals', 'Read HubSpot contacts', 'Read HubSpot tasks', 'Read weekly sheet', 'Read definitions', 'Normalise', 'Sources ok?');
  link('Sources ok?', 'Compute', 0);
  link('Sources ok?', 'Record', 1);
  link('Compute', 'Model needed?');
  link('Model needed?', 'Anthropic', 0);
  link('Model needed?', 'Review', 1);
  link('Anthropic', 'Review');
  chain('Review', 'Render', 'Doc exists?');
  link('Doc exists?', 'Update Doc', 0);
  link('Doc exists?', 'Create Doc', 1);
  link('Update Doc', 'Doc gone?');
  link('Doc gone?', 'Create Doc', 0);
  link('Doc gone?', 'Doc written', 1);
  link('Create Doc', 'Doc written');
  link('Doc written', 'Doc ok?');
  link('Doc ok?', 'Draft', 0);
  link('Doc ok?', 'Record', 1);
  link('Draft', 'Update draft?');
  link('Update draft?', 'Update draft', 0);
  link('Update draft?', 'Create draft?', 1);
  link('Create draft?', 'Create draft', 0);
  link('Create draft?', 'Record', 1);
  link('Update draft', 'Record');
  link('Create draft', 'Record');
  link('Record', 'Outcome');
  link('Error row', 'Outcome');
  chain('Outcome', 'Append ledger', 'After ledger', 'Log error?');
  link('Log error?', 'Append error row', 0);
  chain('Append error row', 'Alert?');
  link('Alert?', 'Alert webhook', 0);

  return {
    id: WORKFLOW_ID,
    name: 'N3 Weekly Business Pulse (readout)',
    active: false,
    nodes,
    connections,
    // No errorWorkflow here: an id set in the file breaks when the editor import assigns a new id (D-067,
    // D-073). docs/SETUP.md step 5 sets Error workflow to this workflow after import.
    settings: {
      executionOrder: 'v1', timezone: 'America/Chicago',
      saveDataSuccessExecution: 'none', saveDataErrorExecution: 'all', saveManualExecutions: false, callerPolicy: 'workflowsFromSameOwner',
    },
    pinData: {},
    meta: { promptVersion: require('../src/prompt').versionOf(prompts.text), builtBy: 'scripts/build-workflow.js', phase: 'Phase 2 (wired; executed offline by test/n8n-sim.js only)' },
    tags: [],
  };
}

const render = () => JSON.stringify(build(), null, 2) + '\n';
const isCurrent = (text) => text === render();

if (require.main === module) {
  const out = render();
  const file = path.join(ROOT, 'workflow.json');
  const cur = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  if (process.argv.includes('--check')) {
    if (cur !== out) { console.error('workflow.json is out of date: run npm run build'); process.exit(1); }
    console.log('workflow.json: up to date');
  } else {
    fs.writeFileSync(file, out);
    console.log(`workflow.json: ${cur === out ? 'unchanged' : 'written'}`);
  }
}

module.exports = { build, render, isCurrent, WORKFLOW_ID, MODULES };
