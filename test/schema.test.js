'use strict';
// PRD §6 check 1; the hand validator cross-checked with Ajv (N7 pattern).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const Ajv2020 = require('ajv/dist/2020');
const S = require('../src/schema');
const H = require('./harness');

const ajvValidate = new Ajv2020({ allErrors: true, strict: false }).compile(H.PROMPTS.schema);
const dir = path.join(H.FIX, 'recorded');
const stands = [
  ...fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => [f, H.readJson(`recorded/${f}`).input]),
  ...fs.readdirSync(path.join(dir, 'variants')).map((f) => [f, H.readJson(`recorded/variants/${f}`)]),
];

test('every recorded stand-in gets the same verdict from the hand validator and from Ajv', () => {
  for (const [name, s] of stands) {
    const input = s.input || s;
    const want = !(s.expectedReason === 'schema');
    assert.strictEqual(S.validatePulse(input).ok, want, `hand: ${name}`);
    assert.strictEqual(ajvValidate(input), want, `ajv: ${name}`);
  }
});

const good = () => JSON.parse(JSON.stringify(H.loadRecorded('E12').input));
const BAD = {
  'extra root key': (o) => { o.mood = 'up'; },
  'missing suggestions': (o) => { delete o.suggestions; },
  'headline not object': (o) => { o.headline = 'x'; },
  'headline extra key': (o) => { o.headline.tone = 'x'; },
  'headline cites not array': (o) => { o.headline.cites = 'revenue.cur'; },
  'empty headline text': (o) => { o.headline.text = ''; },
  'no paragraphs': (o) => { o.paragraphs = []; },
  'five paragraphs': (o) => { o.paragraphs = Array(5).fill(o.paragraphs[0]); },
  'paragraph missing cites': (o) => { delete o.paragraphs[0].cites; },
  'cite not a string': (o) => { o.paragraphs[0].cites = [3]; },
  'four suggestions': (o) => { o.suggestions = Array(4).fill(o.suggestions[0]); },
  'suggestion extra key': (o) => { o.suggestions[0].cites = []; },
  'suggestion not object': (o) => { o.suggestions = ['call them']; },
  'root array': () => [],
  'root null': () => null,
};

test('each schema mutation is rejected by the hand validator AND by Ajv', () => {
  for (const [name, mutate] of Object.entries(BAD)) {
    const o = good();
    const r = mutate(o);
    const input = r === undefined ? o : r;
    assert.strictEqual(S.validatePulse(input).ok, false, `hand accepted: ${name}`);
    assert.strictEqual(ajvValidate(input), false, `ajv accepted: ${name}`);
  }
});
