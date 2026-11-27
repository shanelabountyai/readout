'use strict';
// The Gmail draft (PRD §7, D-016, D-017): to the owner only; plain text; five code-built lines plus the
// Doc's headline (the model's only when the checks passed) and the Doc link. There is no send anywhere.

function isDemoAddress(a) { return typeof a === 'string' && /^[^@\s]+@[^@\s]+$/.test(a) && a.toLowerCase().endsWith('.example'); }

// input: { cfg, weekStart, facts, flags, headline, docLink }
function build({ cfg, weekStart, facts, flags, headline, docLink }) {
  if (cfg.demoMode && !isDemoAddress(cfg.ownerEmail)) return { skip: 'demo_guard_recipient' };
  const f = new Map(facts.map((x) => [x.id, x.rendering]));
  const val = (id, rest) => (f.has(id) ? `${f.get(id)}${rest || ''}` : 'not entered');
  const vs = (m) => (f.has(`${m}.wow_abs`) ? ` (${f.get(`${m}.wow_abs`)} vs last week)` : '');
  const watch = flags.filter((x) => ['quiet_week', 'stalled_deals', 'overdue_tasks', 'revenue_swing', 'cash_drop'].includes(x.code)).map((x) => x.sentence);
  const lines = [
    headline,
    '',
    `${cfg.revenueLabel || 'Revenue (as entered)'}: ${val('revenue.cur', vs('revenue'))}`,
    `Cash at week end: ${val('cash.cur', vs('cash'))}`,
    `Deals won: ${f.get('deals_won.cur')} for ${f.get('won_amount.cur')} (won value, CRM)`,
    `New contacts: ${f.get('new_contacts.cur')}`,
    `Watch: ${watch.length ? watch.join('; ') : 'nothing flagged'}`,
    '',
    `The page: ${docLink}`,
  ];
  return { to: cfg.ownerEmail, subject: `Weekly pulse: week of ${weekStart}`, body: lines.join('\n') };
}

module.exports = { build, isDemoAddress };
