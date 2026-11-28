'use strict';
// A small interpreter for workflow.json, so tests run the exported workflow itself (its Code node source, IF
// expressions, HTTP URLs, bodies, pagination and retry settings, and its connections) against in-memory fakes.
// Method mirrors N7's test/n8n-sim.js; extended for what N3 uses: HTTP pagination ("update a parameter in each
// request" with $response), Retry On Fail / Max Tries, On Error "continue", Execute Once, Never Error + Full
// Response, raw bodies, a fixed clock and a request log. It models the n8n behaviour read from the node source
// of n8n-nodes-base 2.49.8 (D-072) and nothing more. It is NOT n8n: importing into a live n8n is not verified.
//
// Nothing here opens a network connection: every request goes to `env` (below), and an unknown URL throws.

class HttpError extends Error {
  constructor(statusCode, message) { super(`${statusCode} ${message}`); this.statusCode = statusCode; }
}

function evalExpr(v, ctx) {
  if (typeof v !== 'string' || !v.startsWith('=')) return v;
  const m = /^=\{\{([\s\S]*)\}\}$/.exec(v);
  if (!m) throw new Error(`sim: unsupported expression: ${v.slice(0, 60)}`);
  return new Function('$', '$json', '$response', `return (${m[1]});`)(ctx.$, ctx.$json, ctx.$response);
}

// A Date whose argument-less constructor and now() return the injected instant.
function fixedDate(iso) {
  const ms = Date.parse(iso);
  return class FixedDate extends Date {
    constructor(...a) { if (a.length) super(...a); else super(ms); }
    static now() { return ms; }
  };
}

// ---------------- fakes (in memory; ids and behaviour are the sim's, not Google's or HubSpot's)

// fx: a fixtures/weeks/<id>.json; opts: { failures: { hubspot, sheets, ledger, drive, gmailCreate, ledgerAppend },
// model(body) → response | throws, missingTabs: [tab], docs: [ids], drafts: [ids], alertUrl }
function makeEnv(fx, cfg, opts = {}) {
  const fail = { hubspot: 0, sheets: 0, ledger: 0, ledgerAppend: 0, ...(opts.failures || {}) };
  const env = {
    log: [],
    hubspot: { deals: fx.deals, contacts: fx.contacts, tasks: fx.tasks },
    sheets: { [cfg.inputSheetId]: { [cfg.inputTab]: fx.sheet, [cfg.definitionsTab]: fx.definitions }, [cfg.ledgerSheetId]: { [cfg.ledgerTab]: fx.ledger.map((r) => [...r]), [cfg.errorsTab]: [['run_at', 'run_id', 'node', 'reason']] } },
    drive: new Map(), // id -> { name, parents, mimeType, html }
    gmail: new Map(), // id -> { raw?, to?, subject?, body? }
    alerts: [],
    fail,
    nextDoc: 1,
    nextDraft: 1,
    model: opts.model || null,
    missingTabs: opts.missingTabs || [],
    alertUrl: opts.alertUrl || '',
    cfg,
  };
  for (const id of opts.docs || []) env.drive.set(id, { name: 'seeded', parents: [cfg.pulseFolderId], mimeType: 'application/vnd.google-apps.document', html: '' });
  for (const id of opts.drafts || []) env.gmail.set(id, { seeded: true });
  return env;
}

const take = (env, key) => { if (env.fail[key] > 0) { env.fail[key]--; return true; } return false; };

function parseMultipart(contentType, body) {
  const boundary = /boundary=([^;]+)/.exec(contentType)[1];
  const parts = body.split(`--${boundary}`).slice(1, -1).map((p) => p.replace(/^\r\n/, '').replace(/\r\n$/, '')).map((p) => p.slice(p.indexOf('\r\n\r\n') + 4));
  return { metadata: JSON.parse(parts[0]), media: parts[1] };
}

// One HTTP request against the fakes. Returns { statusCode, body } or throws HttpError on a transport-level
// failure the node should see as an error. Non-2xx answers are returned; the caller applies Never Error.
function request(env, { method, url, query, body, rawBody, rawType }) {
  const u = new URL(url);
  for (const [k, v] of Object.entries(query || {})) if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, String(v));
  env.log.push({ method, host: u.host, path: u.pathname, query: Object.fromEntries(u.searchParams) });
  const p = decodeURIComponent(u.pathname);

  if (u.host === 'api.hubapi.com') {
    if (method !== 'GET') return { statusCode: 405, body: { message: 'the fake HubSpot accepts reads only' } };
    if (take(env, 'hubspot')) return { statusCode: 500, body: { status: 'error', message: 'injected' } };
    const m = /^\/crm\/v3\/objects\/(deals|contacts|tasks)$/.exec(p);
    if (!m) return { statusCode: 404, body: {} };
    const pages = env.hubspot[m[1]];
    const after = u.searchParams.get('after');
    const i = after ? pages.findIndex((pg) => pg.paging && pg.paging.next && pg.paging.next.after === after) + 1 : 0;
    if (i < 0 || i >= pages.length) return { statusCode: 400, body: { message: 'bad cursor' } };
    return { statusCode: 200, body: JSON.parse(JSON.stringify(pages[i])) };
  }

  if (u.host === 'sheets.googleapis.com') {
    const m = /^\/v4\/spreadsheets\/([^/]+)\/values\/([^!]+)!([A-Z0-9:]+)(:append)?$/.exec(p);
    if (!m) return { statusCode: 404, body: {} };
    const [, sheetId, tab, , isAppend] = m;
    const book = env.sheets[sheetId];
    if (!book || !(tab in book) || env.missingTabs.includes(tab)) return { statusCode: 400, body: { error: { message: `Unable to parse range: ${tab}` } } };
    if (isAppend) {
      if (method !== 'POST' || u.searchParams.get('insertDataOption') !== 'INSERT_ROWS') return { statusCode: 400, body: {} };
      if (sheetId === env.cfg.ledgerSheetId && tab === env.cfg.ledgerTab && take(env, 'ledgerAppend')) return { statusCode: 503, body: {} };
      for (const r of body.values) book[tab].push(r.map((v) => (v === null || v === undefined ? '' : String(v)))); // RAW: stored as sent, read back as strings
      return { statusCode: 200, body: { updates: { updatedRows: body.values.length } } };
    }
    if (method !== 'GET') return { statusCode: 400, body: {} };
    const isLedger = sheetId === env.cfg.ledgerSheetId;
    if (take(env, isLedger ? 'ledger' : 'sheets')) return { statusCode: 503, body: { error: { message: 'injected' } } };
    return { statusCode: 200, body: { range: `${tab}!A1`, majorDimension: 'ROWS', values: book[tab].map((r) => [...r]) } };
  }

  if (u.host === 'www.googleapis.com' && p.startsWith('/upload/drive/v3/files')) {
    if (u.searchParams.get('uploadType') !== 'multipart') return { statusCode: 400, body: {} };
    const { metadata, media } = parseMultipart(rawType, rawBody);
    if (method === 'POST' && p === '/upload/drive/v3/files') {
      if (take(env, 'drive')) return { statusCode: 500, body: {} };
      const id = `doc-${env.nextDoc++}`;
      env.drive.set(id, { name: metadata.name, parents: metadata.parents, mimeType: metadata.mimeType, html: media });
      return { statusCode: 200, body: { kind: 'drive#file', id, name: metadata.name, mimeType: metadata.mimeType } };
    }
    const m = /^\/upload\/drive\/v3\/files\/([^/]+)$/.exec(p);
    if (method === 'PATCH' && m) {
      if (take(env, 'drive')) return { statusCode: 500, body: {} };
      const f = env.drive.get(m[1]);
      if (!f) return { statusCode: 404, body: { error: { code: 404, message: 'File not found' } } };
      if (metadata.parents) return { statusCode: 400, body: { error: { message: 'parents is not writable on update' } } };
      Object.assign(f, { name: metadata.name, html: media });
      return { statusCode: 200, body: { kind: 'drive#file', id: m[1], name: metadata.name } };
    }
  }

  if (u.host === 'gmail.googleapis.com') {
    const m = /^\/gmail\/v1\/users\/me\/drafts\/([^/]+)$/.exec(p);
    if (m && method === 'PUT') { // drafts.update only; this fake has no send endpoint at all
      if (!env.gmail.has(m[1])) return { statusCode: 404, body: { error: { code: 404, message: 'Requested entity was not found.' } } };
      if (!body || body.id !== m[1] || !body.message || !body.message.raw) return { statusCode: 400, body: {} };
      env.gmail.set(m[1], { raw: body.message.raw });
      return { statusCode: 200, body: { id: m[1], message: { id: `m-${m[1]}` } } };
    }
  }

  if (u.host === 'api.anthropic.com' && p === '/v1/messages' && method === 'POST') {
    if (!env.model) throw new Error('sim: a model call was made but the test gave no model fake');
    return env.model(body);
  }

  if (env.alertUrl && url === env.alertUrl && method === 'POST') { env.alerts.push(body); return { statusCode: 200, body: {} }; }
  throw new Error(`sim: no fake for ${method} ${url}`);
}

// The Gmail node's draft/create, as GmailV2 does it: POST /gmail/v1/users/me/drafts with an encoded message.
function gmailCreate(env, { sendTo, subject, message }) {
  env.log.push({ method: 'POST', host: 'gmail.googleapis.com', path: '/gmail/v1/users/me/drafts', query: {} });
  if (take(env, 'gmailCreate')) throw new HttpError(500, 'injected');
  const id = `draft-${env.nextDraft++}`;
  env.gmail.set(id, { to: sendTo, subject, body: message });
  return { id, message: { id: `m-${id}`, threadId: `t-${id}`, labelIds: ['DRAFT'] } };
}

// ---------------- the executor

async function run(workflow, trigger, env, opts = {}) {
  const byName = new Map(workflow.nodes.map((n) => [n.name, n]));
  const outputs = new Map();
  const order = [];
  const tries = new Map(); // node -> attempts made
  const staticData = opts.staticData || {};
  const FakeDate = fixedDate(opts.now);
  const $ = (name) => {
    if (!byName.has(name)) throw new Error(`sim: unknown node ${name}`);
    const items = outputs.get(name);
    return {
      isExecuted: outputs.has(name),
      first: () => { if (!items) throw new Error(`sim: ${name} has not run`); return items[0]; },
      all: () => items || [],
    };
  };

  // One node run of an HTTP Request node for one item: pagination, then Never Error / Full Response.
  function httpOnce(node, item) {
    const p = node.parameters;
    const ctx = { $, $json: item.json };
    const method = evalExpr(p.method, ctx);
    const url = evalExpr(p.url, ctx);
    const query = p.sendQuery ? Object.fromEntries(p.queryParameters.parameters.map((q) => [q.name, evalExpr(q.value, ctx)])) : {};
    const body = p.sendBody && p.specifyBody === 'json' ? JSON.parse(evalExpr(p.jsonBody, ctx)) : null;
    const rawBody = p.sendBody && p.contentType === 'raw' ? evalExpr(p.body, ctx) : null;
    const rawType = p.sendBody && p.contentType === 'raw' ? evalExpr(p.rawContentType, ctx) : null;
    const headers = p.sendHeaders ? Object.fromEntries(p.headerParameters.parameters.map((h) => [h.name, evalExpr(h.value, ctx)])) : {};
    if (/api\.anthropic\.com/.test(url) && headers['anthropic-version'] !== '2023-06-01') throw new Error('sim: Anthropic call without anthropic-version');
    const resp = p.options && p.options.response && p.options.response.response;
    const neverError = !!(resp && resp.neverError);
    const full = !!(resp && resp.fullResponse);
    const pag = p.options && p.options.pagination && p.options.pagination.pagination;
    const responses = [];
    let q = { ...query };
    for (;;) {
      const r = request(env, { method, url, query: q, body, rawBody, rawType });
      if (!neverError && (r.statusCode < 200 || r.statusCode >= 300)) throw new HttpError(r.statusCode, JSON.stringify(r.body).slice(0, 80));
      responses.push(r);
      if (!pag || pag.paginationMode === 'off') break;
      if (pag.paginationMode !== 'updateAParameterInEachRequest' || pag.paginationCompleteWhen !== 'other') throw new Error('sim: unsupported pagination');
      const $response = { body: r.body, statusCode: r.statusCode, headers: {} };
      if (evalExpr(pag.completeExpression, { $, $json: item.json, $response })) break;
      if (pag.limitPagesFetched && responses.length >= pag.maxRequests) break;
      q = { ...q };
      for (const prm of pag.parameters.parameters) { if (prm.type !== 'qs') throw new Error('sim: qs pagination only'); q[prm.name] = evalExpr(prm.value, { $, $json: item.json, $response }); }
    }
    return responses.map((r) => ({ json: full ? { body: r.body, headers: {}, statusCode: r.statusCode, statusMessage: '' } : r.body }));
  }

  async function exec(node, input) {
    const p = node.parameters;
    const t = node.type;
    if (['n8n-nodes-base.scheduleTrigger', 'n8n-nodes-base.manualTrigger', 'n8n-nodes-base.errorTrigger'].includes(t)) return [input];
    if (t === 'n8n-nodes-base.code') {
      const fn = new Function('$', '$input', '$getWorkflowStaticData', 'require', 'Date', `return (async function () {\n${p.jsCode}\n})();`);
      const out = await fn($, { all: () => input, first: () => input[0] }, () => staticData, require, FakeDate);
      return [out.map((o) => ({ json: JSON.parse(JSON.stringify(o.json)) }))];
    }
    if (t === 'n8n-nodes-base.if') {
      const c = p.conditions.conditions[0];
      if (c.operator.type !== 'boolean' || c.operator.operation !== 'true' || p.conditions.conditions.length !== 1) throw new Error('sim: IF supports one boolean-true condition');
      const yes = []; const no = [];
      for (const item of input) (evalExpr(c.leftValue, { $, $json: item.json }) ? yes : no).push(item);
      return [yes, no];
    }
    const items = node.executeOnce ? input.slice(0, 1) : input;
    const attempts = node.retryOnFail ? (node.maxTries || 3) : 1;
    const once = () => {
      if (t === 'n8n-nodes-base.httpRequest') return items.flatMap((item) => httpOnce(node, item));
      if (t === 'n8n-nodes-base.gmail') {
        if (p.resource !== 'draft' || p.operation !== 'create') throw new Error('sim: the Gmail node must be draft/create');
        return items.map((item) => { const ctx = { $, $json: item.json }; return { json: gmailCreate(env, { sendTo: evalExpr(p.options.sendTo, ctx), subject: evalExpr(p.subject, ctx), message: evalExpr(p.message, ctx) }) }; });
      }
      throw new Error(`sim: unsupported node type ${t}`);
    };
    let lastErr = null;
    for (let i = 0; i < attempts; i++) {
      tries.set(node.name, (tries.get(node.name) || 0) + 1);
      try { return [once()]; } catch (e) {
        if (!(e instanceof HttpError)) throw e;
        lastErr = e;
      }
    }
    if (node.onError === 'continueRegularOutput') return [items.map(() => ({ json: { error: { message: lastErr.message, statusCode: lastErr.statusCode } } }))];
    const err = new Error(`node "${node.name}" failed: ${lastErr.message}`);
    err.node = node.name;
    throw err;
  }

  const queue = [[trigger, opts.triggerItems || [{ json: {} }]]];
  while (queue.length) {
    const [name, input] = queue.shift();
    const node = byName.get(name);
    if (!node) throw new Error(`sim: unknown node ${name}`);
    if (node.disabled) continue;
    let outs;
    try { outs = await exec(node, input); } catch (e) { e.node = e.node || name; e.order = order; throw e; }
    outputs.set(name, outs.find((o) => o.length) || outs[0] || []);
    order.push(name);
    const conns = (workflow.connections[name] || { main: [] }).main;
    outs.forEach((its, i) => { if (its.length) for (const c of conns[i] || []) queue.push([c.node, its]); });
  }
  return { order, outputs, tries, staticData };
}

// What the Error Trigger receives when an execution fails (the fields n8n documents for it).
const errorTriggerItems = (workflow, node) => [{ json: { execution: { id: '901', url: 'http://localhost:5678/execution/901', error: { message: 'failed' }, lastNodeExecuted: node, mode: 'trigger' }, workflow: { id: workflow.id, name: workflow.name } } }];

module.exports = { run, makeEnv, request, evalExpr, fixedDate, errorTriggerItems, HttpError };
