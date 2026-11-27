'use strict';
// Hand-written validator for the write_pulse tool input (prompts/narrate.schema.json). Stricter than JSON
// Schema in one way: it is the only gate, so any extra key, missing key or wrong type fails (PRD §6 check 1).
// test/schema.test.js cross-checks it against Ajv on every stand-in and on a list of mutations.

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function keysExactly(o, required, path, errors) {
  for (const k of required) if (!(k in o)) errors.push(`${path}: missing ${k}`);
  for (const k of Object.keys(o)) if (!required.includes(k)) errors.push(`${path}: unexpected key ${k}`);
}
function str(v, max, path, errors) {
  if (typeof v !== 'string') errors.push(`${path}: not a string`);
  else if (v.length < 1) errors.push(`${path}: empty`);
  else if (v.length > max) errors.push(`${path}: longer than ${max} characters`);
}
function cites(v, path, errors) {
  if (!Array.isArray(v)) { errors.push(`${path}: not an array`); return; }
  if (v.length > 20) errors.push(`${path}: more than 20 cites`);
  v.forEach((c, i) => str(c, 64, `${path}[${i}]`, errors));
}

function validatePulse(o) {
  const errors = [];
  if (!isObj(o)) return { ok: false, errors: ['root: not an object'] };
  keysExactly(o, ['headline', 'paragraphs', 'suggestions'], 'root', errors);
  if ('headline' in o) {
    if (!isObj(o.headline)) errors.push('headline: not an object');
    else { keysExactly(o.headline, ['text', 'cites'], 'headline', errors); str(o.headline.text, 200, 'headline.text', errors); cites(o.headline.cites, 'headline.cites', errors); }
  }
  if ('paragraphs' in o) {
    if (!Array.isArray(o.paragraphs)) errors.push('paragraphs: not an array');
    else {
      if (o.paragraphs.length < 1 || o.paragraphs.length > 4) errors.push('paragraphs: need 1 to 4');
      o.paragraphs.forEach((p, i) => {
        if (!isObj(p)) { errors.push(`paragraphs[${i}]: not an object`); return; }
        keysExactly(p, ['text', 'cites'], `paragraphs[${i}]`, errors);
        str(p.text, 1500, `paragraphs[${i}].text`, errors);
        cites(p.cites, `paragraphs[${i}].cites`, errors);
      });
    }
  }
  if ('suggestions' in o) {
    if (!Array.isArray(o.suggestions)) errors.push('suggestions: not an array');
    else {
      if (o.suggestions.length > 3) errors.push('suggestions: more than 3');
      o.suggestions.forEach((s, i) => {
        if (!isObj(s)) { errors.push(`suggestions[${i}]: not an object`); return; }
        keysExactly(s, ['text'], `suggestions[${i}]`, errors);
        str(s.text, 300, `suggestions[${i}].text`, errors);
      });
    }
  }
  return { ok: errors.length === 0, errors };
}

module.exports = { validatePulse };
