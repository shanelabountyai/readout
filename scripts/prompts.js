'use strict';
// Reads prompts/ for the build script and the tests. Lives outside src/ because src/ never touches the
// filesystem (it runs inside n8n Code nodes, where the build script inlines the prompt text).
const fs = require('fs');
const path = require('path');

function loadPrompts(root = path.join(__dirname, '..')) {
  return {
    text: fs.readFileSync(path.join(root, 'prompts', 'narrate.md'), 'utf8'),
    schema: JSON.parse(fs.readFileSync(path.join(root, 'prompts', 'narrate.schema.json'), 'utf8')),
  };
}

module.exports = { loadPrompts };
