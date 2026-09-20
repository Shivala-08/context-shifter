import test from 'node:test';
import assert from 'node:assert/strict';

import { parseExport } from '../src/parsers/index.js';
import { chatGptConversationToTranscript, roleLabel } from '../src/parsers/chatgpt-export.js';
import { claudeConversationToTranscript } from '../src/parsers/claude-export.js';
import { CliError } from '../src/core/errors.js';

function expectUsageError(fn: () => unknown): void {
  assert.throws(fn, (err: unknown) => err instanceof CliError && err.exitCode === 2);
}

const CHATGPT_CONV = {
  title: 'Test chat',
  update_time: 1700000200,
  current_node: 'n3',
  mapping: {
    n1: { id: 'n1', parent: null, message: { author: { role: 'system' }, content: { content_type: 'text', parts: ['hidden platform prompt'] } } },
    n2: { id: 'n2', parent: 'n1', message: { author: { role: 'user' }, content: { content_type: 'text', parts: ['hello there'] } } },
    n3: { id: 'n3', parent: 'n2', message: { author: { role: 'assistant' }, content: { content_type: 'text', parts: ['hi! how can I help?'] } } },
  },
};

test('chatgpt: walks current_node→root and emits Role: text lines in order', () => {
  const { transcript, warnings } = parseExport('chatgpt-export', JSON.stringify(CHATGPT_CONV));
  assert.equal(transcript, 'User: hello there\n\nAssistant: hi! how can I help?');
  assert.deepEqual(warnings, []);
});

test('chatgpt: system messages, empty messages and non-text parts are handled', () => {
  const conv = {
    current_node: 'n2',
    mapping: {
      n1: { parent: null, message: { author: { role: 'user' }, content: { content_type: 'multimodal_text', parts: ['look:', { content_type: 'image' }] } } },
      n2: { parent: 'n1', message: { author: { role: 'assistant' }, content: { content_type: 'text', parts: ['   '] } } },
    },
  };
  const { transcript } = parseExport('chatgpt-export', JSON.stringify(conv));
  assert.equal(transcript, 'User: look:\n[non-text part]');
});

test('chatgpt: an array picks the most recently updated conversation and warns', () => {
  const older = { ...CHATGPT_CONV, title: 'old', update_time: 1000, mapping: { ...CHATGPT_CONV.mapping } };
  const { transcript, warnings } = parseExport('chatgpt-export', JSON.stringify([older, CHATGPT_CONV]));
  assert.equal(transcript, 'User: hello there\n\nAssistant: hi! how can I help?');
  assert.equal(warnings.length, 1);
  assert.ok(warnings[0]?.includes('2 conversations'));
});

test('chatgpt: malformed inputs are usage errors with a hint', () => {
  expectUsageError(() => parseExport('chatgpt-export', 'not json'));
  expectUsageError(() => parseExport('chatgpt-export', '{"nope":1}'));
  expectUsageError(() => parseExport('chatgpt-export', '[]'));
  expectUsageError(() => parseExport('chatgpt-export', JSON.stringify([{ nope: 1 }])));
  expectUsageError(() => parseExport('chatgpt-export', JSON.stringify({ mapping: { a: { parent: null } } })));
});

test('chatgpt: circular parent chains terminate', () => {
  const conv = {
    current_node: 'a',
    mapping: {
      a: { parent: 'b', message: { author: { role: 'user' }, content: { content_type: 'text', parts: ['loop'] } } },
      b: { parent: 'a', message: { author: { role: 'user' }, content: { content_type: 'text', parts: ['loop'] } } },
    },
  };
  const { transcript } = parseExport('chatgpt-export', JSON.stringify(conv));
  assert.ok(transcript.includes('User: loop'));
});

const CLAUDE_CONV = {
  uuid: 'u1',
  updated_at: '2026-09-01T10:00:00Z',
  chat_messages: [
    { sender: 'human', text: 'what is rust?' },
    { sender: 'assistant', text: '  ', content: [{ type: 'text', text: 'A systems language.' }, { type: 'tool_use' }] },
    { sender: 'human', text: 'thanks' },
  ],
};

test('claude: chat_messages render in order; text falls back to content blocks', () => {
  const { transcript, warnings } = parseExport('claude-export', JSON.stringify(CLAUDE_CONV));
  assert.equal(transcript, 'User: what is rust?\n\nAssistant: A systems language.\n\nUser: thanks');
  assert.deepEqual(warnings, []);
});

test('claude: an array picks the most recently updated conversation and warns', () => {
  const older = { ...CLAUDE_CONV, uuid: 'u0', updated_at: '2020-01-01T00:00:00Z', chat_messages: [{ sender: 'human', text: 'old' }] };
  const { transcript, warnings } = parseExport('claude-export', JSON.stringify([older, CLAUDE_CONV]));
  assert.ok(transcript.includes('what is rust?'));
  assert.equal(warnings.length, 1);
});

test('claude: malformed inputs are usage errors with a hint', () => {
  expectUsageError(() => parseExport('claude-export', 'not json'));
  expectUsageError(() => parseExport('claude-export', '{"nope":1}'));
  expectUsageError(() => parseExport('claude-export', '[]'));
  expectUsageError(() => parseExport('claude-export', JSON.stringify([{ nope: 1 }])));
});

test('direct converters throw the same usage errors', () => {
  expectUsageError(() => chatGptConversationToTranscript({}));
  expectUsageError(() => claudeConversationToTranscript({}));
});

test('roleLabel capitalizes and maps known roles', () => {
  assert.equal(roleLabel('user'), 'User');
  assert.equal(roleLabel('human'), 'User'); // Claude sender → same label
  assert.equal(roleLabel('assistant'), 'Assistant');
  assert.equal(roleLabel('tool'), 'Tool');
  assert.equal(roleLabel('custom'), 'Custom');
});
