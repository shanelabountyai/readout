'use strict';
// Spend caps (D-019, D-046): call cap and dollar cap checked in `plan`; the full gate, adding the per-run
// token ceiling, after the prompt is built. The dollar cap applies only once both prices are set.

const pricesSet = (cfg) => typeof cfg.priceInputPerMTokUsd === 'number' && typeof cfg.priceOutputPerMTokUsd === 'number';

function precheck({ callsThisWeek, spentThisWeekUsd, cfg }) {
  if (callsThisWeek >= cfg.weeklyCallCap) return { allowed: false, reason: 'weekly_cap' };
  if (pricesSet(cfg) && spentThisWeekUsd >= cfg.weeklySpendCapUsd) return { allowed: false, reason: 'spend_cap' };
  return { allowed: true, reason: '' };
}

function gate({ callsThisWeek, estimatedInputTokens, spentThisWeekUsd, cfg }) {
  const p = precheck({ callsThisWeek, spentThisWeekUsd, cfg });
  if (!p.allowed) return p;
  if (estimatedInputTokens > cfg.perRunTokenCeiling) return { allowed: false, reason: 'token_ceiling' };
  return { allowed: true, reason: '' };
}

// Model cost in dollars (a number), or null while prices are unset (N7's shape).
function costUsd(usage, cfg) {
  if (!pricesSet(cfg) || !usage) return null;
  return ((usage.input_tokens || 0) * cfg.priceInputPerMTokUsd + (usage.output_tokens || 0) * cfg.priceOutputPerMTokUsd) / 1e6;
}

module.exports = { precheck, gate, costUsd, pricesSet };
