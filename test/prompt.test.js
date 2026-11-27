'use strict';
const test = require('node:test');
const assert = require('node:assert');
const P = require('../src/prompt');
const H = require('./harness');

test('request body: forced write_pulse tool, model and max_tokens from config, version narrate-v0.1', () => {
  const r = H.runWeek('E01');
  const req = r.computed.request;
  assert.strictEqual(req.promptVersion, 'narrate-v0.1');
  assert.deepStrictEqual(req.body.tool_choice, { type: 'tool', name: 'write_pulse' });
  assert.strictEqual(req.body.tools[0].name, 'write_pulse');
  assert.deepStrictEqual(req.body.tools[0].input_schema, H.PROMPTS.schema);
  assert.strictEqual(req.body.model, 'claude-sonnet-5-5');
  assert.strictEqual(req.body.max_tokens, 1500);
  assert.strictEqual(req.estimatedInputTokens, Math.ceil(JSON.stringify(req.body).length / 4));
});

test('D-007: the E01 body contains every fact id and no email address, contact or task data', () => {
  const r = H.runWeek('E01');
  const raw = JSON.stringify(r.computed.request.body);
  const sent = JSON.parse(r.computed.request.body.messages[0].content);
  assert.deepStrictEqual(sent.facts.map((f) => f.id), r.facts.map((f) => f.id));
  assert.deepStrictEqual(Object.keys(sent).sort(), ['facts', 'flags', 'stalledDeals', 'week']);
  assert.deepStrictEqual(Object.keys(sent.facts[0]).sort(), ['id', 'label', 'rendering', 'sign', 'type']);
  assert.doesNotMatch(raw, /@/);
  assert.doesNotMatch(raw, /\.example/);
  assert.doesNotMatch(raw, /Send revised scope|Chase signed SOW/);
  assert.doesNotMatch(raw, /New enquiry|Won engagement|Prairie Line/, 'deal names leave only for stalled deals (D-032)');
});

test('E08: the stalled deal name is sent; E18: the excluded .test contact is not', () => {
  assert.match(JSON.stringify(H.runWeek('E08').computed.request.body), /Bluewater fleet reporting/);
  assert.doesNotMatch(JSON.stringify(H.runWeek('E18').computed.request.body), /newprospect/);
});

test('versionOf and toolInput', () => {
  assert.throws(() => P.versionOf('no version here'));
  assert.deepStrictEqual(P.toolInput({ content: [{ type: 'text', text: 'x' }, { type: 'tool_use', name: 'write_pulse', input: { a: 1 } }] }), { a: 1 });
  assert.strictEqual(P.toolInput({ content: [{ type: 'text', text: 'x' }] }), null);
});
