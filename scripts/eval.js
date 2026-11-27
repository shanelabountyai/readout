'use strict';
// Prints the golden-week table from the step harness and recorded stand-ins (hand-written, NOT model
// output), and exits non-zero if any week differs from its hand-typed expected file.
const H = require('../test/harness');
const FL = require('../src/flags');
const { WEEKS, TRUNCATED, VARIANTS } = require('../fixtures/spec');
const C = require('../src/checks');

let ok = 0;
let total = 0;
const rows = [];
for (const w of [...WEEKS, TRUNCATED]) {
  const e = H.loadExpected(w.id);
  const r = H.runWeek(w.id);
  const flags = r.flags.map(FL.label);
  const wantFlags = e.flags || e.flagsInclude;
  let match = r.outcome === e.outcome && r.reason === e.reason && r.modelCalls === e.modelCalls && JSON.stringify(flags) === JSON.stringify(wantFlags);
  if (e.facts) match = match && JSON.stringify(Object.fromEntries(r.facts.map((f) => [f.id, f.rendering]))) === JSON.stringify(e.facts);
  total++; if (match) ok++;
  rows.push(`${w.id.padEnd(14)} ${r.outcome.padEnd(13)} ${(r.reason || '-').padEnd(26)} calls ${r.modelCalls}  ${(flags.join(',') || '-').padEnd(44)} ${match ? 'match' : 'DIFF'}`);
}
const e01 = H.runWeek('E01');
let vOk = 0;
for (const v of VARIANTS) {
  const c = C.check(H.loadVariant(v.id).input, e01.facts, []);
  const m = c.reason === v.reason;
  if (m) vOk++;
  rows.push(`${v.id.padEnd(26)} check variant -> ${c.reason.padEnd(22)} ${m ? 'match' : 'DIFF'}`);
}
console.log('Golden weeks (PRD §9) through the step harness; model text is recorded stand-ins, not model output.\n');
console.log(rows.join('\n'));
console.log(`\n${ok}/${total} golden weeks (incl. E01-truncated) match their expected files; ${vOk}/${VARIANTS.length} check variants give their reason.`);
if (ok !== total || vOk !== VARIANTS.length) process.exit(1);
