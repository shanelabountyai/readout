'use strict';
// AC-04 (no float money), purity of src/ (time passed in; only ./ requires).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src');
const files = fs.readdirSync(SRC).filter((f) => f.endsWith('.js'));
const code = (f) => fs.readFileSync(path.join(SRC, f), 'utf8').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

test('AC-04: no Math.round, parseFloat or toFixed in src/ outside src/num.js', () => {
  for (const f of files.filter((x) => x !== 'num.js')) {
    assert.doesNotMatch(code(f), /Math\.round|parseFloat|toFixed/, f);
  }
  assert.doesNotMatch(code('num.js'), /Math\.round|parseFloat/, 'num.js rounds with integers only');
});

test('src/ never reads the clock: no Date.now( and no argument-less new Date()', () => {
  for (const f of files) {
    assert.doesNotMatch(code(f), /Date\.now\(|new Date\(\s*\)/, f);
    assert.doesNotMatch(code(f), /(?<!new\s)(?<![.\w])Date\(\s*\)/, f);
  }
});

test('src/ requires only other src/ modules (it runs inside n8n Code nodes)', () => {
  for (const f of files) {
    for (const m of code(f).matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      assert.match(m[1], /^\.\/[a-z]+$/, `${f} requires ${m[1]}`);
      assert.ok(files.includes(`${m[1].slice(2)}.js`), `${f} requires missing ${m[1]}`);
    }
  }
});

test('package.json: no runtime dependencies; devDependencies are N7\'s four', () => {
  const pkg = require('../package.json');
  assert.strictEqual(pkg.dependencies, undefined);
  assert.deepStrictEqual(Object.keys(pkg.devDependencies).sort(), ['@eslint/js', 'ajv', 'eslint', 'globals']);
  assert.strictEqual(pkg.scripts.gate, 'npm run lint && npm run check && npm test');
});
