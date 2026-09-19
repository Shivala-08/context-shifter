#!/usr/bin/env node
'use strict';

/**
 * context-transfer — CLI companion to the Context Transfer macOS app.
 * Reads a conversation from stdin or --file, extracts a context card via
 * Ollama (default), Anthropic, or NVIDIA NIM, prints the card to stdout.
 *
 * TRD: /TRD_cli.md · PRD: /PRD_cli.md
 */

const fs = require('fs');
const { parseArgs } = require('util');

const { loadConfig, saveConfig, CONFIG_PATH } = require('../src/config');
const { REQUIRED_HEADERS } = require('../src/validate');

const VERSION = require('../package.json').version;

const BACKENDS = {
  ollama: () => require('../src/backends/ollama'),
  anthropic: () => require('../src/backends/anthropic'),
  nim: () => require('../src/backends/nim'),
};

const DEFAULT_BACKEND = 'ollama';
const DEFAULT_MODEL = 'qwen3:8b'; // Ollama default; other backends have their own

function usage() {
  return `context-transfer v${VERSION} — turn a conversation into a portable context card.

Usage:
  pbpaste | context-transfer                    extract from stdin
  context-transfer --file transcript.txt        extract from a file
  context-transfer --backend anthropic          pick a backend (ollama|anthropic|nim)
  context-transfer --json                       machine-readable output
  context-transfer config --set defaultBackend=ollama

Options:
  --file <path>     Read the conversation from a file instead of stdin
  --backend <name>  ollama (default, local & free) | anthropic | nim
  --model <name>    Model override (default: qwen3:8b for Ollama; backend-specific otherwise)
  --host <url>      Ollama host override (default: OLLAMA_HOST env or http://localhost:11434)
  --json            Emit structured JSON instead of the markdown card
  --help, -h        Show this help
  --version, -v     Show version

Environment:
  OLLAMA_HOST           Ollama host (e.g. http://localhost:11434)
  ANTHROPIC_API_KEY     Required for --backend anthropic
  NVIDIA_NIM_API_KEY    Required for --backend nim

Config (optional, never store API keys here):
  ${CONFIG_PATH}

The card goes to stdout, warnings to stderr — safe to pipe: pbpaste | context-transfer | pbcopy`;
}

function fail(message) {
  process.stderr.write('Error: ' + message + '\n');
  process.exit(1);
}

/** Prints the `config` subcommand help to stderr and exits. */
function printConfigHelp() {
  process.stderr.write(
    'Manage the optional config file at ' + CONFIG_PATH + '\n' +
    '\n' +
    'Usage:\n' +
    '  context-transfer config                          show current config\n' +
    '  context-transfer config --set defaultBackend=ollama\n' +
    '  context-transfer config --set defaultModel=qwen3:8b\n' +
    '\n' +
    'Allowed keys: defaultBackend, defaultModel. CLI flags override the config;\n' +
    'the config overrides built-in defaults. API keys are NEVER stored here —\n' +
    'use the ANTHROPIC_API_KEY / NVIDIA_NIM_API_KEY environment variables.\n'
  );
  process.exit(1);
}

/** Handles `context-transfer config [--set key=value]`. Never returns. */
function runConfigSubcommand(rest) {
  const setIdx = rest.indexOf('--set');
  if (setIdx === -1) {
    const current = loadConfig();
    if (Object.keys(current).length === 0) {
      process.stderr.write('No config set (' + CONFIG_PATH + '). Defaults apply: backend=' + DEFAULT_BACKEND + ', model=' + DEFAULT_MODEL + '\n');
    } else {
      process.stdout.write(JSON.stringify(current, null, 2) + '\n');
    }
    process.exit(0);
  }

  const assignment = rest[setIdx + 1];
  if (!assignment || assignment.startsWith('--')) {
    printConfigHelp();
  }
  const eq = assignment.indexOf('=');
  if (eq === -1) {
    printConfigHelp();
  }
  const key = assignment.slice(0, eq).trim();
  const value = assignment.slice(eq + 1).trim();
  try {
    const next = saveConfig({ [key]: value });
    process.stdout.write('Saved ' + key + '=' + value + ' to ' + CONFIG_PATH + '\n');
    process.stdout.write(JSON.stringify(next, null, 2) + '\n');
    process.exit(0);
  } catch (err) {
    fail(err && err.message ? err.message : String(err));
  }
}

function parseFlags(argv) {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      options: {
        file: { type: 'string' },
        backend: { type: 'string' },
        model: { type: 'string' },
        host: { type: 'string' },
        json: { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
        version: { type: 'boolean', short: 'v', default: false },
      },
      allowPositionals: true,
      strict: true,
    });
  } catch (err) {
    fail((err && err.message ? err.message : String(err)) + '\n\n' + usage());
  }
  // Flatten: parseArgs nests flags under .values; merge so callers read
  // parsed.file / parsed.help / parsed.positionals at one level.
  return { ...parsed.values, positionals: parsed.positionals };
}

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => (data += chunk));
    process.stdin.on('end', () => resolve(data));
    // No piped input (TTY) — resolve immediately with empty string.
    if (process.stdin.isTTY) resolve('');
  });
}

async function readInput(parsed) {
  if (parsed.file) {
    try {
      return fs.readFileSync(parsed.file, 'utf8');
    } catch (err) {
      fail('Cannot read file "' + parsed.file + '": ' + (err && err.message ? err.message : err));
    }
  }
  const piped = await readStdin();
  if (!piped.trim()) {
    fail(
      'No input. Pipe a conversation in (pbpaste | context-transfer) or pass --file <path>.\n\n' + usage()
    );
  }
  return piped;
}

async function main() {
  const argv = process.argv.slice(2);

  // `config` subcommand — handled before flag parsing so its own flags
  // (--set key=value) don't trip strict parseArgs.
  if (argv[0] === 'config') {
    runConfigSubcommand(argv.slice(1));
  }

  const parsed = parseFlags(argv);
  if (parsed.help) {
    process.stdout.write(usage() + '\n');
    return;
  }
  if (parsed.version) {
    process.stdout.write('context-transfer v' + VERSION + '\n');
    return;
  }
  if (parsed.positionals.length > 0) {
    fail('Unexpected argument(s): ' + parsed.positionals.join(' ') + '\n\n' + usage());
  }

  const warnings = [];
  const onWarning = (msg) => {
    warnings.push(msg);
    process.stderr.write('⚠️  ' + msg + '\n');
  };

  // Precedence: CLI flags > config file > built-in defaults (TRD §6).
  const config = loadConfig();
  const backendName = (parsed.backend || config.defaultBackend || DEFAULT_BACKEND).toLowerCase();
  const loadBackend = BACKENDS[backendName];
  if (!loadBackend) {
    fail(
      'Unknown backend "' + backendName + '". Valid options: ' + Object.keys(BACKENDS).join(', ') + '.'
    );
  }

  const input = await readInput(parsed);

  const backendOptions = { onWarning };
  if (backendName === 'ollama') {
    backendOptions.host = parsed.host || process.env.OLLAMA_HOST;
    backendOptions.model = parsed.model || config.defaultModel || DEFAULT_MODEL;
  } else if (parsed.model || config.defaultModel) {
    backendOptions.model = parsed.model || config.defaultModel;
  }

  let card;
  try {
    card = await loadBackend().extract(input, backendOptions);
  } catch (err) {
    fail(err && err.message ? err.message : String(err));
  }

  if (parsed.json) {
    process.stdout.write(
      JSON.stringify(
        {
          backend: backendName,
          capturedOn: (card.match(/^Captured on: (\d{4}-\d{2}-\d{2})/) || [])[1] || null,
          card,
          formatValid: REQUIRED_HEADERS.every((h) => card.includes(h)),
          warnings,
        },
        null,
        2
      ) + '\n'
    );
  } else {
    process.stdout.write(card + '\n');
  }
}

main().catch((err) => {
  fail(err && err.stack ? err.stack : String(err));
});
