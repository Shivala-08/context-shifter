import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { readInput, DEFAULT_MAX_INPUT_BYTES } from '../src/io/input.js';
import { CliError, EXIT } from '../src/core/errors.js';

function withTempFile(content: string, encoding: BufferEncoding = 'utf8'): string {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cshift-')), 'input.txt');
  fs.writeFileSync(file, content, encoding);
  return file;
}

function expectUsage(fn: () => Promise<unknown>, match: RegExp): Promise<CliError> {
  return fn().then(
    () => {
      throw new Error('expected readInput to throw');
    },
    (err: unknown) => {
      assert.ok(err instanceof CliError, `expected CliError, got ${String(err)}`);
      assert.equal((err as CliError).exitCode, EXIT.USAGE);
      assert.match((err as CliError).message, match);
      return err as CliError;
    }
  );
}

test('DEFAULT_MAX_INPUT_BYTES is the 10 MB guard (TRD §4.2)', () => {
  assert.equal(DEFAULT_MAX_INPUT_BYTES, 10 * 1024 * 1024);
});

test('reads a UTF-8 file', async () => {
  const file = withTempFile('hello conversation');
  assert.equal(await readInput({ file }), 'hello conversation');
});

test('reads a UTF-16LE file the way PowerShell writes them (PRD R8)', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cshift-')), 'utf16.txt');
  fs.writeFileSync(file, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('wide text', 'utf16le')]));
  assert.equal(await readInput({ file }), 'wide text');
});

test('normalizes CRLF and ANSI pastes', async () => {
  const file = withTempBuffer(Buffer.from('\x1b[32m$ git status\x1b[0m\r\n\r\n clean', 'utf8'));
  assert.equal(await readInput({ file }), '$ git status\n\n clean'.trim());
});

function withTempBuffer(buf: Buffer): string {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cshift-')), 'input.bin');
  fs.writeFileSync(file, buf);
  return file;
}

test('a missing file is a usage error', async () => {
  await expectUsage(() => readInput({ file: '/nonexistent/nope.txt' }), /Cannot read file/);
});

test('oversized input is refused with the --max-input hint', async () => {
  const file = withTempBuffer(Buffer.alloc(64, 0x61));
  await expectUsage(() => readInput({ file, maxBytes: 32 }), /over the 32 byte limit/);
});

test('empty input is a usage error with the pipe hint', async () => {
  const file = withTempFile('   \n\r\n  ');
  await expectUsage(() => readInput({ file }), /No input\. Pipe a conversation/);
});
