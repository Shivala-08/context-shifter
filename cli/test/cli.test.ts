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

test('config command is refused with exit 2 until v0.2 (PRD R23)', () => {
  parseExpectError(['config', 'get'], EXIT.USAGE);
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
