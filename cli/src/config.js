'use strict';

/**
 * Optional config file support (TRD §6): ~/.context-transfer/config.json
 *
 * Precedence: CLI flags > config file > built-in defaults.
 * Keys are NEVER stored here (TRD §5) — a value that looks like an API key
 * in any field triggers a loud warning instead of being used.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const CONFIG_DIR = path.join(os.homedir(), '.context-transfer');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');

const ALLOWED_KEYS = new Set(['defaultBackend', 'defaultModel']);

// Patterns that scream "this is a secret, not a preference" (TRD §5).
const KEY_LIKE_PATTERNS = [/^sk-ant-/, /^nvapi-/, /^sk-/];

function looksLikeApiKey(value) {
  return typeof value === 'string' && KEY_LIKE_PATTERNS.some((re) => re.test(value.trim()));
}

/** Reads + validates the config file. Returns {} when absent. */
function loadConfig() {
  let raw;
  try {
    raw = fs.readFileSync(CONFIG_PATH, 'utf8');
  } catch {
    return {}; // No config file — the normal case.
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      'Config file at ' + CONFIG_PATH + ' is not valid JSON (' + err.message + '). Fix or remove it, then try again.'
    );
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Config file at ' + CONFIG_PATH + ' must contain a JSON object with keys: ' + [...ALLOWED_KEYS].join(', ') + '.');
  }

  // TRD §5: never use a key-like value that a user pasted into the file by
  // mistake — warn loudly and drop it instead of silently reading it.
  for (const [key, value] of Object.entries(parsed)) {
    if (looksLikeApiKey(value)) {
      process.stderr.write(
        '⚠️  Config file field "' + key + '" looks like an API key (' + String(value).slice(0, 8) + '…). ' +
          'Config files must NEVER store keys — move it to the ANTHROPIC_API_KEY or NVIDIA_NIM_API_KEY environment variable and delete it from ' + CONFIG_PATH + '.\n'
      );
      delete parsed[key];
      continue;
    }
    if (!ALLOWED_KEYS.has(key)) {
      process.stderr.write('⚠️  Ignoring unknown config key "' + key + '" (allowed: ' + [...ALLOWED_KEYS].join(', ') + ').\n');
      delete parsed[key];
    }
  }

  return parsed;
}

/** Merges `updates` ({key: value}) into the config file, creating it if needed. */
function saveConfig(updates) {
  let current = {};
  try {
    current = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    if (current === null || typeof current !== 'object' || Array.isArray(current)) current = {};
  } catch {
    // Missing or unreadable — start fresh.
  }

  const next = { ...current };
  for (const [key, value] of Object.entries(updates)) {
    if (!ALLOWED_KEYS.has(key)) {
      throw new Error('Unknown config key "' + key + '". Allowed keys: ' + [...ALLOWED_KEYS].join(', ') + '.');
    }
    if (looksLikeApiKey(value)) {
      throw new Error(
        '"' + key + '" looks like an API key. Config files must never store keys — set the ANTHROPIC_API_KEY or NVIDIA_NIM_API_KEY environment variable instead.'
      );
    }
    next[key] = value;
  }

  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2) + '\n');
  return next;
}

module.exports = { CONFIG_DIR, CONFIG_PATH, ALLOWED_KEYS, looksLikeApiKey, loadConfig, saveConfig };
