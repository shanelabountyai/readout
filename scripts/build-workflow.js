'use strict';
// Generates workflow.json (the n8n export, Phase 1 skeleton) from src/*.js, prompts/, rules/ and
// config/config.template.json. Code nodes inline the tested src/ modules (N7's bundle pattern), so the
// workflow runs exactly the code the tests run. External nodes carry placeholder parameters, noted
// "Phase 2". Never hand-edit workflow.json; test/workflow.test.js and `npm run check` catch drift.
// Usage: node scripts/build-workflow.js           (write workflow.json)
//        node scripts/build-workflow.js --check   (exit 1 if workflow.json is out of date)
const fs = require('fs');
const path = require('path');
const { loadPrompts } = require('./prompts');

const ROOT = path.join(__dirname, '..');
const WORKFLOW_ID = 'n3WeeklyBusinessPulse';
const MODULES = ['num', 'week', 'hubspot', 'sheet', 'metrics', 'compare', 'flags', 'facts', 'prompt', 'schema', 'checks', 'template', 'doc', 'email', 'ledger', 'spend', 'steps'];
const PHASE2 = 'Phase 2: parameters are placeholders until the wiring phase (docs/IMPLEMENTATION_PLAN.md).';

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
  return out + "const M = { steps: __lib['./steps'], prompt: __lib['./prompt'] };\n";
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
  const http = (name, position, cred, { method = 'GET', url, query, json } = {}) => {
    const p = { method, url, authentication: 'predefinedCredentialType', nodeCredentialType: CRED_TYPE[cred] };
    if (query) { p.sendQuery = true; p.queryParameters = { parameters: Object.entries(query).map(([n, value]) => ({ name: n, value })) }; }
    if (json) { p.sendBody = true; p.specifyBody = 'json'; p.jsonBody = json; }
    p.options = {};
    return node(name, 'n8n-nodes-base.httpRequest', 4.2, position, p, { credentials: CRED[cred], notes: PHASE2 });
  };
  const sheetsGet = (name, position, idKey, tabKey, range) => http(name, position, 'drive', {
    url: `={{ 'https://sheets.googleapis.com/v4/spreadsheets/' + $('config').first().json.${idKey} + '/values/' + encodeURIComponent($('config').first().json.${tabKey} + '!${range}') + '?valueRenderOption=FORMATTED_VALUE' }}`,
  });
  const hubspotGet = (name, position, object, properties, extraQuery = {}) => http(name, position, 'hubspot', {
    url: `https://api.hubapi.com/crm/v3/objects/${object}`, query: { limit: '100', properties, archived: 'false', ...extraQuery },
  });

  // ---------------- triggers and the only account-specific node
  node('Schedule (Mon 10:00 America/Chicago)', 'n8n-nodes-base.scheduleTrigger', 1.2, [-1600, -100], { rule: { interval: [{ field: 'weeks', weeksInterval: 1, triggerAtDay: [1], triggerAtHour: 10, triggerAtMinute: 0 }] } });
  node('Manual', 'n8n-nodes-base.manualTrigger', 1, [-1600, 100], {});
  code('config', [-1380, 0], `
// THE ONLY ACCOUNT-SPECIFIC NODE (CLAUDE.md). Fill in the REPLACE_WITH_ values in Phase 3 (docs/SETUP.md, Phase 2).
const cfg = ${JSON.stringify(cfg, null, 2)};
return [{ json: { ...cfg, _runAt: new Date().toISOString() } }];
`, { lib: false });
  link('Schedule (Mon 10:00 America/Chicago)', 'config');
  link('Manual', 'config');

  // ---------------- plan, read, compute
  sheetsGet('Read ledger', [-1160, 0], 'ledgerSheetId', 'ledgerTab', 'A:P');
  code('Plan', [-940, 0], `
const cfg = $('config').first().json;
const ledger = $('Read ledger').first().json;
return [{ json: M.steps.plan({ cfg, runAtIso: cfg._runAt, ledgerValues: ledger.values || [] }) }];
`);
  hubspotGet('Read HubSpot deals', [-720, 0], 'deals', 'dealname,dealstage,pipeline,amount,createdate,closedate,notes_last_updated', { propertiesWithHistory: 'dealstage' });
  hubspotGet('Read HubSpot contacts', [-500, 0], 'contacts', 'email,createdate');
  hubspotGet('Read HubSpot tasks', [-280, 0], 'tasks', 'hs_task_subject,hs_task_status,hs_timestamp');
  sheetsGet('Read weekly sheet', [-60, 0], 'inputSheetId', 'inputTab', 'A:H');
  sheetsGet('Read definitions', [160, 0], 'inputSheetId', 'definitionsTab', 'A:C');
  code('Normalise', [380, 0], `
// Phase 2 replaces the single page per object with paged reads up to cfg.hubspotMaxPages.
const cfg = $('config').first().json;
const p = $('Plan').first().json;
const page = (n) => { const j = $(n).first().json; return { records: j.results || [], truncated: !!(j.paging && j.paging.next) }; };
const d = page('Read HubSpot deals'); const c = page('Read HubSpot contacts'); const t = page('Read HubSpot tasks');
const hubspotRaw = { deals: d.records, contacts: c.records, tasks: t.records,
  truncated: { deals: d.truncated, contacts: c.truncated, tasks: t.truncated, readCounts: { deals: d.records.length, contacts: c.records.length, tasks: t.records.length } } };
const sheetValues = { weekly: $('Read weekly sheet').first().json.values || [], definitions: $('Read definitions').first().json.values || [] };
return [{ json: M.steps.normalise({ cfg, plan: p, hubspotRaw, sheetValues }) }];
`);
  code('Compute', [600, 0], `
const cfg = $('config').first().json;
return [{ json: M.steps.compute({ cfg, plan: $('Plan').first().json, norm: $('Normalise').first().json, rules: RULES, prompts: PROMPTS }) }];
`);
  ifNode('Model needed?', [820, 0], '={{ $json.modelNeeded }}');
  http('Anthropic', [1040, -120], 'anthropic', {
    method: 'POST', url: 'https://api.anthropic.com/v1/messages', json: "={{ JSON.stringify($('Compute').first().json.request.body) }}",
  });
  code('Review', [1260, 0], `
const computed = $('Compute').first().json;
let toolInput = null; let modelError = false;
if (computed.modelNeeded) {
  const resp = $('Anthropic').first().json;
  modelError = !resp || !!resp.error;
  toolInput = modelError ? null : M.prompt.toolInput(resp);
}
return [{ json: M.steps.review({ computed, toolInput, modelError }) }];
`);
  code('Render', [1480, 0], `
const cfg = $('config').first().json;
return [{ json: M.steps.render({ cfg, plan: $('Plan').first().json, computed: $('Compute').first().json, reviewed: $('Review').first().json }) }];
`);
  ifNode('Doc exists?', [1700, 0], "={{ !!$('Plan').first().json.prior.docId }}");
  http('Update Doc', [1920, -120], 'drive', {
    method: 'PATCH', url: "={{ 'https://www.googleapis.com/upload/drive/v3/files/' + $('Plan').first().json.prior.docId + '?uploadType=multipart&supportsAllDrives=true' }}",
    json: "={{ JSON.stringify({ name: $('Render').first().json.title }) }}",
  });
  http('Create Doc', [1920, 120], 'drive', {
    method: 'POST', url: 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true',
    json: "={{ JSON.stringify({ name: $('Render').first().json.title, mimeType: 'application/vnd.google-apps.document', parents: [$('config').first().json.pulseFolderId] }) }}",
  });
  code('Draft', [2140, 0], `
const cfg = $('config').first().json;
const p = $('Plan').first().json;
const doc = $input.first().json;
const docId = p.prior.docId || doc.id;
const mail = M.steps.draft({ cfg, plan: p, computed: $('Compute').first().json, rendered: $('Render').first().json, docLink: 'https://docs.google.com/document/d/' + docId + '/edit' });
const action = p.prior.draftState === 'gone' ? 'gone' : mail.skip ? 'skip' : p.prior.draftId ? 'update' : 'create';
return [{ json: { ...mail, docId, action, draftId: p.prior.draftId } }];
`);
  ifNode('Update draft?', [2360, 0], "={{ $json.action === 'update' }}");
  http('Update draft', [2580, -160], 'gmail', {
    method: 'PUT', url: "={{ 'https://gmail.googleapis.com/gmail/v1/users/me/drafts/' + $('Draft').first().json.draftId }}",
    json: "={{ JSON.stringify({ id: $('Draft').first().json.draftId }) }}", // Phase 2: add message.raw (RFC 822, base64url) built from to/subject/body
  });
  ifNode('Create draft?', [2580, 80], "={{ $json.action === 'create' }}");
  node('Create draft', 'n8n-nodes-base.gmail', 2.1, [2800, 0], {
    resource: 'draft', operation: 'create', subject: '={{ $json.subject }}', emailType: 'text', message: '={{ $json.body }}',
    options: { sendTo: "={{ $('config').first().json.ownerEmail }}" },
  }, { credentials: CRED.gmail, notes: PHASE2, retryOnFail: false });
  code('Record', [3020, 80], `
// Phase 2 derives draft state from the Gmail responses (a 404 on update is 'gone').
const cfg = $('config').first().json;
const p = $('Plan').first().json;
const r = $('Review').first().json;
const d = $('Draft').first().json;
const computed = $('Compute').first().json;
const draftState = { update: 'updated', create: 'created', gone: 'gone', skip: 'skipped' }[d.action];
const reason = r.reason || (d.action === 'skip' ? d.skip : '');
const modelCalls = computed.modelNeeded ? 1 : 0;
const draftId = d.action === 'create' ? String(($('Create draft').first().json || {}).id || '') : (d.draftId || '');
const row = M.steps.record({ cfg, plan: p, computed, status: r.status, reason, docId: d.docId, draftId, draftState, modelCalls, usage: null, runtimeS: 0 });
return [{ json: { row } }];
`);
  http('Append ledger', [3240, 80], 'drive', {
    method: 'POST',
    url: "={{ 'https://sheets.googleapis.com/v4/spreadsheets/' + $('config').first().json.ledgerSheetId + '/values/' + encodeURIComponent($('config').first().json.ledgerTab + '!A1:P1') + ':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS' }}",
    json: '={{ JSON.stringify({ values: [$json.row] }) }}',
  });

  chain('config', 'Read ledger', 'Plan', 'Read HubSpot deals', 'Read HubSpot contacts', 'Read HubSpot tasks', 'Read weekly sheet', 'Read definitions', 'Normalise', 'Compute', 'Model needed?');
  link('Model needed?', 'Anthropic', 0);
  link('Model needed?', 'Review', 1);
  link('Anthropic', 'Review');
  chain('Review', 'Render', 'Doc exists?');
  link('Doc exists?', 'Update Doc', 0);
  link('Doc exists?', 'Create Doc', 1);
  link('Update Doc', 'Draft');
  link('Create Doc', 'Draft');
  link('Draft', 'Update draft?');
  link('Update draft?', 'Update draft', 0);
  link('Update draft?', 'Create draft?', 1);
  link('Create draft?', 'Create draft', 0);
  link('Create draft?', 'Record', 1);
  link('Update draft', 'Record');
  link('Create draft', 'Record');
  link('Record', 'Append ledger');

  // ---------------- error path: an `errors` tab row, never an email (an optional webhook is Phase 2)
  node('Error Trigger', 'n8n-nodes-base.errorTrigger', 1, [-1600, 400], {});
  code('Error row', [-1380, 400], `
const e = $input.first().json;
const node = String((e.execution && e.execution.lastNodeExecuted) || 'unknown').replace(/[^A-Za-z0-9 /_-]/g, '').slice(0, 60) || 'unknown';
const reason = /HubSpot/.test(node) ? 'hubspot_error' : /sheet|ledger|definitions/i.test(node) ? 'sheet_error' : /Doc/.test(node) ? 'drive_error' : /draft/i.test(node) ? 'gmail_error' : /Anthropic/.test(node) ? 'model_error' : 'unknown_error';
return [{ json: { row: M.steps.errorRow({ runAtIso: new Date().toISOString(), runId: '', node, reason }) } }];
`);
  http('Append error row', [-1160, 400], 'drive', {
    method: 'POST',
    url: "={{ 'https://sheets.googleapis.com/v4/spreadsheets/' + $('config').first().json.ledgerSheetId + '/values/' + encodeURIComponent($('config').first().json.errorsTab + '!A1:D1') + ':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS' }}",
    json: '={{ JSON.stringify({ values: [$json.row] }) }}',
  });
  chain('Error Trigger', 'Error row', 'Append error row');

  return {
    id: WORKFLOW_ID,
    name: 'N3 Weekly Business Pulse (readout)',
    active: false,
    nodes,
    connections,
    settings: {
      executionOrder: 'v1', timezone: 'America/Chicago', errorWorkflow: WORKFLOW_ID,
      saveDataSuccessExecution: 'none', saveDataErrorExecution: 'all', saveManualExecutions: false, callerPolicy: 'workflowsFromSameOwner',
    },
    pinData: {},
    meta: { promptVersion: require('../src/prompt').versionOf(prompts.text), builtBy: 'scripts/build-workflow.js', phase: 'Phase 1 skeleton' },
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
