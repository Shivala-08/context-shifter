import test from 'node:test';
import assert from 'node:assert/strict';

import { parseArgsTo, type ParsedCli } from '../src/cli.js';
import { CliError, EXIT } from '../src/core/errors.js';

function parseExpectError(args: string[], expectedExit: number): CliError {
  let caught: unknown;
  try {
    parseArgsTo(args);
  } catch (err) {
    caught = err;
  }
  assert.ok(caught instanceof CliError, `expected CliError for ${JSON.stringify(args)}`);
  const cliError = caught as CliError;
  assert.equal(cliError.exitCode, expectedExit);
  return cliError;
}

test('no args defaults to extract from stdin', () => {
  const parsed: ParsedCli = parseArgsTo([]);
  assert.equal(parsed.command, 'extract');
  assert.equal(parsed.file, undefined);
  assert.equal(parsed.level, 'balanced');
  assert.equal(parsed.offline, false);
  assert.equal(parsed.quiet, false);
  assert.equal(parsed.copy, false);
});

test('a bare file positional implies extract', () => {
  const parsed = parseArgsTo(['transcript.txt']);
  assert.equal(parsed.command, 'extract');
  assert.equal(parsed.file, 'transcript.txt');
});

test('extract accepts a file positional', () => {
  const parsed = parseArgsTo(['extract', 'chat.log']);
  assert.equal(parsed.command, 'extract');
  assert.equal(parsed.file, 'chat.log');
});

test('--extract (site compat alias, PRD F1) routes to extract with a file', () => {
  const parsed = parseArgsTo(['--extract', 'chat.log']);
  assert.equal(parsed.command, 'extract');
  assert.equal(parsed.file, 'chat.log');
});

test('doctor and models commands parse', () => {
  assert.equal(parseArgsTo(['doctor']).command, 'doctor');
  assert.equal(parseArgsTo(['models']).command, 'models');
});

test('--capture is refused with exit 2 (macOS-only, PRD F1)', () => {
  parseExpectError(['--capture'], EXIT.USAGE);
});

test('config command routes with its subcommand args (PRD R23)', () => {
  const parsed = parseArgsTo(['config', 'set', 'level', 'minimal']);
  assert.equal(parsed.command, 'config');
  assert.deepEqual(parsed.configArgs, ['set', 'level', 'minimal']);
});

test('unknown flags are usage errors (strict parseArgs)', () => {
  parseExpectError(['--backendx', 'ollama'], EXIT.USAGE);
});

test('invalid level is a usage error', () => {
  parseExpectError(['--level', 'turbo'], EXIT.USAGE);
});

test('level comes from CONTEXT_SHIFTER_LEVEL when the flag is absent', () => {
  process.env.CONTEXT_SHIFTER_LEVEL = 'minimal';
  try {
    assert.equal(parseArgsTo([]).level, 'minimal');
  } finally {
    delete process.env.CONTEXT_SHIFTER_LEVEL;
  }
});

test('flag beats env for level', () => {
  process.env.CONTEXT_SHIFTER_LEVEL = 'minimal';
  try {
    assert.equal(parseArgsTo(['--level', 'full']).level, 'full');
  } finally {
    delete process.env.CONTEXT_SHIFTER_LEVEL;
  }
});

test('backend and model come from CONTEXT_SHIFTER_* env vars', () => {
  process.env.CONTEXT_SHIFTER_BACKEND = 'nim';
  process.env.CONTEXT_SHIFTER_MODEL = 'meta/llama-3.3-70b-instruct';
  try {
    const parsed = parseArgsTo([]);
    assert.equal(parsed.backend, 'nim');
    assert.equal(parsed.model, 'meta/llama-3.3-70b-instruct');
  } finally {
    delete process.env.CONTEXT_SHIFTER_BACKEND;
    delete process.env.CONTEXT_SHIFTER_MODEL;
  }
});

test('--ctx must be a token count >= 1024', () => {
  parseExpectError(['--ctx', '512'], EXIT.USAGE);
  assert.equal(parseArgsTo(['--ctx', '16384']).ctx, 16384);
});

test('--max-input must be a positive byte count', () => {
  parseExpectError(['--max-input', '0'], EXIT.USAGE);
  parseExpectError(['--max-input', 'abc'], EXIT.USAGE);
  assert.equal(parseArgsTo(['--max-input', '2048']).maxInputBytes, 2048);
});

test('output flags parse', () => {
  const parsed = parseArgsTo(['--out', 'card.md', '--copy', '--quiet', '--offline']);
  assert.equal(parsed.out, 'card.md');
  assert.equal(parsed.copy, true);
  assert.equal(parsed.quiet, true);
  assert.equal(parsed.offline, true);
});

test('--json, --redact and --from parse (PRD R17/R18/R19)', () => {
  const parsed = parseArgsTo(['--json', '--redact', '--from', 'chatgpt-export', 'export.json']);
  assert.equal(parsed.json, true);
  assert.equal(parsed.redact, true);
  assert.equal(parsed.from, 'chatgpt-export');
  assert.equal(parsed.file, 'export.json');
  assert.equal(parseArgsTo([]).json, false);
  assert.equal(parseArgsTo([]).redact, false);
  assert.equal(parseArgsTo([]).from, undefined);
  assert.equal(parseArgsTo(['--from', 'claude-export']).from, 'claude-export');
});

test('invalid --from is a usage error naming the valid formats', () => {
  const err = parseExpectError(['--from', 'slack-export'], EXIT.USAGE);
  assert.ok(err.hint?.includes('chatgpt-export'));
});

test('config-file defaults fill gaps; flag beats env beats file (TRD §4.3)', () => {
  process.env.CONTEXT_SHIFTER_LEVEL = 'minimal';
  try {
    const fileConfig = { backend: 'anthropic', model: 'claude-sonnet-4-6', level: 'full' };
    const parsed = parseArgsTo([], fileConfig);
    assert.equal(parsed.backend, 'anthropic');
    assert.equal(parsed.model, 'claude-sonnet-4-6');
    assert.equal(parsed.level, 'minimal'); // env beats file
    assert.equal(parseArgsTo(['--level', 'balanced'], fileConfig).level, 'balanced'); // flag beats env
    assert.equal(parseArgsTo(['--backend', 'nim'], fileConfig).backend, 'nim'); // flag beats file
    assert.equal(parseArgsTo([]).level, 'minimal'); // no file: env still applies
  } finally {
    delete process.env.CONTEXT_SHIFTER_LEVEL;
  }
});

test('--version, -v, --help, -h map to their commands', () => {
  assert.equal(parseArgsTo(['--version']).command, 'version');
  assert.equal(parseArgsTo(['-v']).command, 'version');
  assert.equal(parseArgsTo(['--help']).command, 'help');
  assert.equal(parseArgsTo(['-h']).command, 'help');
});

test('extra positionals are usage errors', () => {
  parseExpectError(['extract', 'a.txt', 'b.txt'], EXIT.USAGE);
});

test('exit codes cover the TRD §4.5 contract', () => {
  assert.deepEqual(Object.values(EXIT).sort((a, b) => a - b), [0, 1, 2, 3, 4, 5]);
});
