'use strict';
// The Messages API request body for the one model call (D-007): forced tool write_pulse, and only the fact
// table, flag sentences and stalled deals' names. Built here; never sent by any test.

function versionOf(promptText) {
  const m = /^Version:\s*(narrate-v\d+\.\d+)\s*$/m.exec(promptText || '');
  if (!m) throw new Error('prompts/narrate.md has no "Version: narrate-vX.Y" line');
  return m[1];
}

// prompts: { text: narrate.md contents, schema: narrate.schema.json object }
function build({ facts, flags, stalled, weekStart, cfg, prompts }) {
  const payload = {
    week: weekStart,
    facts: facts.map((f) => ({ id: f.id, label: f.label, type: f.type, rendering: f.rendering, sign: f.sign })),
    flags: flags.map((x) => ({ code: x.code, sentence: x.sentence })),
    stalledDeals: stalled.map((s) => s.name),
  };
  const body = {
    model: cfg.model,
    max_tokens: cfg.maxOutputTokens,
    system: prompts.text,
    tools: [{ name: 'write_pulse', description: 'Return the weekly pulse narrative. Call exactly once.', input_schema: prompts.schema }],
    tool_choice: { type: 'tool', name: 'write_pulse' },
    messages: [{ role: 'user', content: JSON.stringify(payload) }],
  };
  return { body, promptVersion: versionOf(prompts.text), estimatedInputTokens: Math.ceil(JSON.stringify(body).length / 4) };
}

// The tool input from a Messages API response, or null.
function toolInput(response) {
  const block = ((response && response.content) || []).find((b) => b.type === 'tool_use' && b.name === 'write_pulse');
  return block ? block.input : null;
}

module.exports = { build, versionOf, toolInput };
