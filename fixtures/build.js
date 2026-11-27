'use strict';
// Expands fixtures/spec.js into the files a run sees. Never runs the engine: expected/*.json are the
// hand-typed `expected` blocks from spec.js, written unchanged.
// Usage: node fixtures/build.js          (write)
//        node fixtures/build.js --check  (exit 1 if any committed fixture differs)
const fs = require('fs');
const path = require('path');
const S = require('./spec');

const DIR = __dirname;
const HOUR = 3600000;
const isoMs = (ms) => new Date(ms).toISOString(); // HubSpot style: 2026-11-17T15:00:00.000Z
const at = (weekIdx, hours) => isoMs(Date.parse(S.WEEK_STARTS_UTC[weekIdx]) + hours * HOUR);

const OPEN_STAGES = ['appointmentscheduled', 'qualifiedtobuy', 'presentationscheduled', 'decisionmakerboughtin', 'contractsent'];
const CREATED_BEFORE = '2026-09-01T15:00:00.000Z';
const STAGE_SET = '2026-09-15T15:00:00.000Z';
const CLOSED_AFTER_WINDOW = '2026-11-23T12:00:00.000Z'; // after the report week end, before the 16:00Z run
const NOTES_RECENT = '2026-11-20T15:00:00.000Z';

const MOVERS = [ // ten open deals that carry the week-by-week moves; amounts sum to $187,000
  ['[demo] Prairie Line dispatch audit', '25000'], ['[demo] Cedar Ridge onboarding kit', '22000.00'],
  ['[demo] Lakeshore benefits review', '20000'], ['[demo] Northgate pricing study', '19000'],
  ['[demo] Ironwood retention plan', '18000.00'], ['[demo] Silver Fork board pack', '17000'],
  ['[demo] Redbud ops playbook', '18000'], ['[demo] Kettle Creek vendor scorecard', '16000'],
  ['[demo] Willow Bend hiring plan', '17000'], ['[demo] Granite Hill KPI refresh', '15000'],
];
const COMPANIES = ['bluewaterlogistics', 'harborviewcu', 'prairieline', 'cedarridge', 'lakeshorehealth', 'northgatefoods', 'ironwoodmfg', 'silverforkhotels', 'redbudclinics', 'kettlecreek'];

const hist = (entries) => entries.map(([value, timestamp]) => ({ value, timestamp, sourceType: 'CRM_UI' })).reverse(); // HubSpot: newest first
function deal(id, name, stage, amount, createdate, closedate, notes, history) {
  return {
    id: String(id),
    properties: { hs_object_id: String(id), dealname: name, dealstage: stage, pipeline: 'default', amount, createdate, closedate, notes_last_updated: notes },
    propertiesWithHistory: { dealstage: hist(history) },
    createdAt: createdate, updatedAt: notes || createdate, archived: false,
  };
}

function expand(inputs) {
  const x = { ...S.BASE, ...inputs };
  let nextId = 1001;
  const openDeals = [];
  const closedDeals = [];
  const createdDeals = [];

  // the two named open deals (PRD §9 E01/E08)
  openDeals.push(deal(nextId++, '[demo] Bluewater fleet reporting', 'contractsent', '15000', CREATED_BEFORE, null, x.bluewaterLastActivity, [['appointmentscheduled', CREATED_BEFORE], ['contractsent', STAGE_SET]]));
  openDeals.push(deal(nextId++, '[demo] Harborview member portal', 'qualifiedtobuy', '8000.00', CREATED_BEFORE, null, x.harborviewLastActivity, [['appointmentscheduled', CREATED_BEFORE], ['qualifiedtobuy', STAGE_SET]]));

  // movers: mover i moves in week w when i < moved[w]; each move goes to the next open stage in the cycle
  MOVERS.forEach(([name, amount], i) => {
    const h = [['appointmentscheduled', CREATED_BEFORE]];
    let k = 0;
    x.moved.forEach((n, w) => { if (i < n) { k += 1; h.push([OPEN_STAGES[k % OPEN_STAGES.length], at(w, 48 + 2 * i)]); } });
    openDeals.push(deal(nextId++, name, h[h.length - 1][0], amount, CREATED_BEFORE, null, NOTES_RECENT, h));
  });

  // won and lost deals, created before the window, closed in their week
  x.won.forEach((amounts, w) => amounts.forEach((dollars, i) => {
    const close = at(w, 72 + i);
    closedDeals.push(deal(nextId++, `[demo] Won engagement ${S.WEEK_LABELS[w]} #${i + 1}`, 'closedwon', String(dollars), CREATED_BEFORE, close, close, [['appointmentscheduled', CREATED_BEFORE], ['closedwon', close]]));
  }));
  x.lost.forEach((n, w) => { for (let i = 0; i < n; i++) {
    const close = at(w, 96 + i);
    closedDeals.push(deal(nextId++, `[demo] Lost proposal ${S.WEEK_LABELS[w]} #${i + 1}`, 'closedlost', '5000', CREATED_BEFORE, close, close, [['appointmentscheduled', CREATED_BEFORE], ['closedlost', close]]));
  } });

  // deals created in the window: closed lost after the report week, so they touch only deals_created
  x.created.forEach((n, w) => { for (let i = 0; i < n; i++) {
    const c = at(w, 39 + 3 * i);
    createdDeals.push(deal(nextId++, `[demo] New enquiry ${S.WEEK_LABELS[w]} #${i + 1}`, 'closedlost', '3000', c, CLOSED_AFTER_WINDOW, CLOSED_AFTER_WINDOW, [['appointmentscheduled', c], ['closedlost', CLOSED_AFTER_WINDOW]]));
  } });

  const all = [...openDeals, ...closedDeals, ...createdDeals];
  const deals = inputs.dealPages === 2
    ? [{ results: [...openDeals, ...closedDeals], paging: { next: { after: 'page2' } } }, { results: createdDeals }]
    : [{ results: all }];

  let cid = 5001;
  const contacts = [];
  x.contacts.forEach((n, w) => { for (let i = 0; i < n; i++) {
    const c = at(w, 26 + 2 * i);
    contacts.push({ id: String(cid++), properties: { email: `contact.${S.WEEK_LABELS[w].slice(5)}.${i + 1}@${COMPANIES[(w + i) % COMPANIES.length]}.example`, createdate: c }, createdAt: c, archived: false });
  } });
  for (const email of x.extraContacts) {
    const c = at(4, 50);
    contacts.push({ id: String(cid++), properties: { email, createdate: c }, createdAt: c, archived: false });
  }

  let tid = 8001;
  const task = (subject, status, due) => ({ id: String(tid++), properties: { hs_task_subject: subject, hs_task_status: status, hs_timestamp: due }, archived: false });
  const tasks = [
    task('[demo] Send revised scope', 'NOT_STARTED', '2026-11-19T15:00:00.000Z'),
    task('[demo] Chase signed SOW', 'NOT_STARTED', '2026-11-20T15:00:00.000Z'),
    task('[demo] Book kickoff call', 'COMPLETED', '2026-11-18T15:00:00.000Z'),
    task('[demo] Prepare QBR deck', 'NOT_STARTED', '2026-11-25T15:00:00.000Z'),
  ];
  if (x.overdue === 4) {
    tasks.push(task('[demo] Update renewal forecast', 'IN_PROGRESS', '2026-11-21T15:00:00.000Z'));
    tasks.push(task('[demo] Confirm invoice details', 'WAITING', '2026-11-12T15:00:00.000Z'));
  } else if (x.overdue !== 2) throw new Error(`overdue ${x.overdue} not supported by the generator`);

  return {
    runAt: x.runAt,
    deals, contacts: [{ results: contacts }], tasks: [{ results: tasks }],
    sheet: [['week_start', 'revenue_usd', 'cash_usd'], ...x.sheet],
    definitions: [['key', 'label', 'unit']],
    ledger: x.ledger.length ? x.ledger : [S.LEDGER_HEADER],
    hubspotFailures: x.hubspotFailures,
  };
}

function files() {
  const out = {};
  const put = (rel, obj) => { out[rel] = JSON.stringify(obj, null, 2) + '\n'; };
  const index = [];
  for (const w of S.WEEKS) {
    put(`weeks/${w.id}.json`, { id: w.id, title: w.title, ...expand(w.inputs) });
    put(`expected/${w.id}.json`, w.expected);
    if (w.recorded) put(`recorded/${w.id}.json`, stand(w.recorded));
    index.push({ id: w.id, title: w.title, outcome: w.expected.outcome, reason: w.expected.reason });
  }
  const t = S.TRUNCATED;
  put(`weeks/${t.id}.json`, { id: t.id, title: t.title, hubspotMaxPages: t.hubspotMaxPages, ...expand(t.inputs) });
  put(`expected/${t.id}.json`, t.expected);
  put(`recorded/${t.id}.json`, stand(t.recorded));
  for (const v of S.VARIANTS) put(`recorded/variants/${v.id}.json`, { ...stand(v.recorded), expectedReason: v.reason });
  put('index.json', index);
  const cfg = JSON.parse(fs.readFileSync(path.join(DIR, '..', 'config', 'config.template.json'), 'utf8'));
  put('test-config.json', { ...cfg, pulseFolderId: 'test-folder-pulse', inputSheetId: 'test-sheet-weekly', ledgerSheetId: 'test-sheet-ledger' });
  return out;
}

// A recorded stand-in: the hand-written write_pulse input plus an output-token ESTIMATE (characters / 4).
function stand(input) {
  return {
    note: 'Hand-written stand-in for the write_pulse tool input. NOT model output. usage.output_tokens is characters/4, an estimate, not a measurement.',
    input,
    usage: { output_tokens: Math.ceil(JSON.stringify(input).length / 4) },
  };
}

if (require.main === module) {
  const out = files();
  const check = process.argv.includes('--check');
  let stale = 0;
  for (const [rel, text] of Object.entries(out)) {
    const file = path.join(DIR, rel);
    const cur = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
    if (cur === text) continue;
    if (check) { console.error(`stale: fixtures/${rel}`); stale++; } else { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); }
  }
  for (const sub of ['weeks', 'expected', 'recorded', 'recorded/variants']) {
    for (const f of fs.readdirSync(path.join(DIR, sub)).filter((n) => n.endsWith('.json'))) {
      if (!out[`${sub}/${f}`]) { if (check) { console.error(`unexpected: fixtures/${sub}/${f}`); stale++; } else fs.unlinkSync(path.join(DIR, sub, f)); }
    }
  }
  if (check && stale) { console.error('fixtures are out of date: run npm run build'); process.exit(1); }
  console.log(`fixtures: ${Object.keys(out).length} files ${check ? 'up to date' : 'written'}`);
}

module.exports = { expand, files };
