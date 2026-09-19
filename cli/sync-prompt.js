'use strict';

/**
 * sync-prompt.js — prompt-drift guard (PRD §8 / TRD §3).
 *
 * Generates cli/src/prompt.js's TEMPLATE block from the canonical
 * /prompt/extraction-template.md at the repo root. Run from anywhere:
 *
 *     node cli/sync-prompt.js          # regenerate cli/src/prompt.js
 *     node cli/sync-prompt.js --check  # exit 1 if the copy is stale (CI)
 *
 * The Swift side is manually synced — see the comment above systemPromptBase
 * in Sources/ContextTransfer/ExtractionBackend.swift.
 */

const fs = require('fs');
const path = require('path');

const CLI_DIR = __dirname;
const TEMPLATE_PATH = path.join(CLI_DIR, '..', 'prompt', 'extraction-template.md');
const PROMPT_JS_PATH = path.join(CLI_DIR, 'src', 'prompt.js');

const BEGIN_MARKER = '// BEGIN TEMPLATE — managed by sync-prompt.js';
const END_MARKER = '// END TEMPLATE';

/** Extracts the literal prompt (everything after the last `---` rule). */
function readCanonicalTemplate() {
  const md = fs.readFileSync(TEMPLATE_PATH, 'utf8');
  const sep = md.lastIndexOf('\n---\n');
  if (sep === -1) {
    throw new Error('No "---" separator found in ' + TEMPLATE_PATH + ' — cannot locate the literal prompt.');
  }
  const literal = md.slice(sep + '\n---\n'.length).trim();
  if (!literal) {
    throw new Error('The prompt section of ' + TEMPLATE_PATH + ' is empty.');
  }
  return literal;
}

/** Escapes the literal so it can sit inside a JS template literal. */
function escapeForTemplateLiteral(text) {
  return text.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
}

function renderTemplateBlock(literal) {
  return (
    BEGIN_MARKER + '\n' +
    'const TEMPLATE = `' + escapeForTemplateLiteral(literal) + '`;\n' +
    END_MARKER
  );
}

function regenerate() {
  const literal = readCanonicalTemplate();
  const current = fs.readFileSync(PROMPT_JS_PATH, 'utf8');

  const beginIdx = current.indexOf(BEGIN_MARKER);
  const endIdx = current.indexOf(END_MARKER);
  if (beginIdx === -1 || endIdx === -1 || endIdx < beginIdx) {
    throw new Error('Markers missing in ' + PROMPT_JS_PATH + ' — expected "' + BEGIN_MARKER + '" … "' + END_MARKER + '".');
  }

  const next = current.slice(0, beginIdx) + renderTemplateBlock(literal) + current.slice(endIdx + END_MARKER.length);
  fs.writeFileSync(PROMPT_JS_PATH, next);
  console.log('Synced cli/src/prompt.js from prompt/extraction-template.md (' + literal.length + ' chars).');
}

function check() {
  const literal = readCanonicalTemplate();
  const current = fs.readFileSync(PROMPT_JS_PATH, 'utf8');

  const beginIdx = current.indexOf(BEGIN_MARKER);
  const endIdx = current.indexOf(END_MARKER);
  if (beginIdx === -1 || endIdx === -1 || endIdx < beginIdx) {
    console.error('STALE: markers missing in ' + PROMPT_JS_PATH + '.');
    process.exit(1);
  }

  const expectedBlock = renderTemplateBlock(literal);
  const actualBlock = current.slice(beginIdx, endIdx + END_MARKER.length);
  if (actualBlock !== expectedBlock) {
    console.error('STALE: cli/src/prompt.js drifted from prompt/extraction-template.md.');
    console.error('Run `node cli/sync-prompt.js` (and update the Swift copy in ExtractionBackend.swift) in the same commit.');
    process.exit(1);
  }
  console.log('OK: cli/src/prompt.js matches prompt/extraction-template.md.');
}

if (require.main === module) {
  try {
    if (process.argv.includes('--check')) check();
    else regenerate();
  } catch (err) {
    console.error('Error: ' + (err && err.message ? err.message : err));
    process.exit(1);
  }
}

module.exports = { readCanonicalTemplate, renderTemplateBlock };
