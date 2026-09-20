import test from 'node:test';
import assert from 'node:assert/strict';

import { decodeBytes, normalizeText } from '../src/io/encoding.js';

function utf16leBytes(s: string, withBom: boolean): Uint8Array {
  const body = Buffer.from(s, 'utf16le');
  return withBom ? Buffer.concat([Buffer.from([0xff, 0xfe]), body]) : body;
}

/** Swaps every byte pair — turns a UTF-16LE buffer into UTF-16BE. */
function swapPairs(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i += 2) {
    out[i] = bytes[i + 1] ?? 0;
    out[i + 1] = bytes[i] ?? 0;
  }
  return out;
}

test('decodeBytes strips a UTF-8 BOM', () => {
  const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('hello', 'utf8')]);
  const res = decodeBytes(bytes);
  assert.equal(res.encoding, 'utf-8-bom');
  assert.equal(res.text, 'hello');
});

test('decodeBytes decodes UTF-16LE with BOM (PowerShell 5.1 pipes)', () => {
  const res = decodeBytes(utf16leBytes('héllo world', true));
  assert.equal(res.encoding, 'utf-16le');
  assert.equal(res.text, 'héllo world');
});

test('decodeBytes decodes UTF-16BE with BOM via byte swap', () => {
  const le = utf16leBytes('bonjour', false);
  const bytes = Buffer.concat([Buffer.from([0xfe, 0xff]), swapPairs(le)]);
  const res = decodeBytes(bytes);
  assert.equal(res.encoding, 'utf-16be');
  assert.equal(res.text, 'bonjour');
});

test('decodeBytes detects BOM-less UTF-16LE by 0x00-at-odd-offsets', () => {
  const res = decodeBytes(utf16leBytes('detect me please', false));
  assert.equal(res.encoding, 'utf-16le');
  assert.equal(res.text, 'detect me please');
});

test('decodeBytes defaults to UTF-8 with replacement for stray bytes', () => {
  const bytes = new Uint8Array([0x68, 0x69, 0xff]); // "hi" + invalid byte
  const res = decodeBytes(bytes);
  assert.equal(res.encoding, 'utf-8');
  assert.match(res.text, /^hi/);
  assert.ok(res.text.includes('\uFFFD'));
});

test('normalizeText converts CRLF and CR to LF', () => {
  assert.equal(normalizeText('a\r\nb\rc\nd'), 'a\nb\nc\nd');
});

test('normalizeText strips ANSI escape sequences', () => {
  assert.equal(normalizeText('\x1b[31mred\x1b[0m \x1b]0;title\x07text'), 'red text');
});

test('normalizeText trims the result', () => {
  assert.equal(normalizeText('  padded \n'), 'padded');
});
