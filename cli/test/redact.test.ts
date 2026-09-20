import test from 'node:test';
import assert from 'node:assert/strict';

import { REDACTION_RULES, describeMatches, findSecrets, redactSecrets } from '../src/core/redact.js';

const ANTHROPIC = 'sk-ant-api03-abcdefghij0123456789ABCDE';
const GENERIC_SK = 'sk-abcdefghij0123456789ABCD';
const NVIDIA = 'nvapi-abcdefghij0123456789ABCD';
const GITHUB = 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef123456';
const GITHUB_PAT = 'github_pat_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef1234567890ABCD';
const SLACK = 'xoxb-123456789-abcdefghij';
const AWS = 'AKIAIOSFODNN7EXAMPLE';
const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const PEM = '-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA\n-----END RSA PRIVATE KEY-----';

test('every rule compiles and has a distinct type', () => {
  const types = REDACTION_RULES.map((r) => r.type);
  assert.equal(new Set(types).size, types.length);
});

test('anthropic keys are redacted before the generic sk- rule sees them', () => {
  const { text, matches } = redactSecrets(`key ${ANTHROPIC} end`);
  assert.equal(text, 'key [REDACTED:anthropic-key] end');
  assert.deepEqual(matches, [{ type: 'anthropic-key', count: 1 }]);
  assert.ok(!text.includes('sk-'), 'no raw key text may survive');
});

test('generic sk- keys are redacted', () => {
  const { text, matches } = redactSecrets(`key ${GENERIC_SK} end`);
  assert.equal(text, 'key [REDACTED:api-key] end');
  assert.deepEqual(matches, [{ type: 'api-key', count: 1 }]);
});

test('nvidia, github, slack, aws, jwt, bearer and PEM patterns all fire', () => {
  const input = [
    NVIDIA,
    GITHUB,
    GITHUB_PAT,
    SLACK,
    AWS,
    JWT,
    'Authorization: Bearer abcdefghij0123456789ABC',
    PEM,
  ].join('\n');
  const { text, matches } = redactSecrets(input);
  assert.ok(!text.includes(NVIDIA));
  assert.ok(!text.includes(GITHUB));
  assert.ok(!text.includes(GITHUB_PAT));
  assert.ok(!text.includes(SLACK));
  assert.ok(!text.includes(AWS));
  assert.ok(!text.includes(JWT));
  assert.ok(!text.includes('Bearer abcdefghij0123456789ABC'));
  assert.ok(!text.includes('MIIEpAIBAAKCAQEA'));
  const types = matches.map((m) => m.type);
  assert.deepEqual(matches, [
    { type: 'private-key', count: 1 },
    { type: 'nvidia-key', count: 1 },
    { type: 'github-token', count: 2 }, // ghp_ + github_pat_ share one rule
    { type: 'slack-token', count: 1 },
    { type: 'aws-key', count: 1 },
    { type: 'jwt', count: 1 },
    { type: 'bearer-token', count: 1 },
  ]);
});

test('"Bearer tokens are boring" is NOT treated as a secret', () => {
  const input = 'The header "Bearer tokens" carries credentials.';
  assert.deepEqual(findSecrets(input), []);
});

test('plain prose and URLs are untouched', () => {
  const input = 'See https://example.com/spec for the skunkworks update and the sk8-hard tricks.';
  assert.deepEqual(findSecrets(input), []);
  assert.equal(redactSecrets(input).text, input);
});

test('findSecrets reports counts without modifying the text', () => {
  const input = `${GENERIC_SK} and ${GENERIC_SK} again`;
  const found = findSecrets(input);
  assert.deepEqual(found, [{ type: 'api-key', count: 2 }]);
});

test('describeMatches renders "2 api-key, 1 jwt" style text', () => {
  assert.equal(describeMatches([{ type: 'api-key', count: 2 }, { type: 'jwt', count: 1 }]), '2 api-key, 1 jwt');
  assert.equal(describeMatches([]), '');
});
