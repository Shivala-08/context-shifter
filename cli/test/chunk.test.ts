import test from 'node:test';
import assert from 'node:assert/strict';

import { computeInputBudget, groupForMerge, planChunks, splitTurns } from '../src/core/chunk.js';
import { estimateTokens } from '../src/core/tokens.js';

test('computeInputBudget reserves output + margin locally and scales by 0.8', () => {
  // (8192 - 500 - 1500 - 300) * 0.8 = 4713
  assert.equal(computeInputBudget(8192, 500, true), 4713);
});

test('computeInputBudget for cloud uses the declared budget without the 0.8 factor', () => {
  assert.equal(computeInputBudget(100_000, 500, false), 99_200);
});

test('computeInputBudget clamps to a sane minimum', () => {
  assert.equal(computeInputBudget(512, 500, true), 200);
});

test('splitTurns prefers speaker labels', () => {
  const [units, mode] = splitTurns('user: hi there\n\nassistant: hello, what do you need?');
  assert.equal(mode, 'speakers');
  assert.deepEqual(units, ['user: hi there', 'assistant: hello, what do you need?']);
});

test('splitTurns falls back to blank-line paragraphs', () => {
  const [units, mode] = splitTurns('first paragraph\n\nsecond paragraph\n\nthird');
  assert.equal(mode, 'paragraphs');
  assert.equal(units.length, 3);
});

test('splitTurns never splits inside a fenced code block', () => {
  const text = 'user: look at this\n\n```py\ndef f():\n    pass\n\n\nx = 1\n```\n\nassistant: ok';
  const [units, mode] = splitTurns(text);
  const fenced = units.filter((u) => u.includes('def f'));
  assert.equal(mode !== 'single', true);
  // The fence opens in one unit and closes before the boundary — never split mid-fence.
  for (const u of units) {
    const fences = u.split('\n').filter((l) => /^\s*```/.test(l)).length;
    assert.equal(fences % 2, 0, 'unbalanced fence inside a unit');
  }
  assert.ok(fenced.length > 0);
});

test('splitTurns returns a single unit for tiny inputs', () => {
  const [units, mode] = splitTurns('just one line');
  assert.deepEqual(units, ['just one line']);
  assert.equal(mode, 'single');
});

function turn(speaker: string, sizeChars: number): string {
  return `${speaker}: ${'x'.repeat(sizeChars)}`;
}

test('planChunks packs units within budget and never drops content', () => {
  const turns: string[] = [];
  for (let i = 0; i < 10; i++) turns.push(turn(i % 2 === 0 ? 'user' : 'assistant', 400));
  const text = turns.join('\n\n');
  const budget = 300; // each turn is ~100 tokens → ~3 turns per chunk
  const chunks = planChunks(text, budget);

  assert.equal(chunks[0]?.total, chunks.length);
  assert.ok(chunks.length > 1, 'expected multiple chunks');
  const all = chunks.map((c) => c.text).join('\n');
  for (const t of turns) {
    assert.ok(all.includes(t), 'every turn must survive chunking');
  }
  for (const c of chunks) {
    assert.ok(estimateTokens(c.text) <= budget + Math.floor(budget * 0.1), `chunk ${c.index} over budget+overlap`);
  }
  chunks.forEach((c, i) => assert.equal(c.index, i + 1));
});

test('planChunks overlaps chunks with the previous last turns', () => {
  // Turns must be small enough to fit the 10%-of-budget overlap window.
  const turns: string[] = [];
  for (let i = 0; i < 30; i++) turns.push(turn(i % 2 === 0 ? 'user' : 'assistant', 100)); // ~26 tokens
  const text = turns.join('\n\n');
  const budget = 300; // overlap window 30 tokens → the last turn (~26) fits
  const chunks = planChunks(text, budget);
  assert.ok(chunks.length > 1);
  const lastOfFirst = (chunks[0]?.text ?? '').split('\n\n').slice(-1)[0] ?? '';
  assert.ok(lastOfFirst.length > 0);
  assert.ok((chunks[1]?.text ?? '').startsWith(lastOfFirst), 'chunk 2 should start with the overlap');
});

test('planChunks keeps an oversized unit as its own chunk', () => {
  const big = 'user: ' + 'y'.repeat(8000); // ~2000 tokens, over any budget below
  const small = 'assistant: short reply';
  const chunks = planChunks(`${big}\n\n${small}`, 500);
  assert.ok(chunks.some((c) => c.text === big), 'oversized unit kept verbatim');
  assert.ok(chunks.some((c) => c.text.includes(small)));
});

test('planChunks returns a single chunk when the input fits', () => {
  const text = 'user: short';
  const chunks = planChunks(text, 1000);
  assert.deepEqual(chunks, [{ text, index: 1, total: 1 }]);
});

test('groupForMerge packs partials greedily within budget', () => {
  const partials = ['a'.repeat(400), 'b'.repeat(400), 'c'.repeat(400)]; // 100 tokens each
  const groups = groupForMerge(partials, 250); // 2 fit, 3rd starts a new group
  assert.equal(groups.length, 2);
  assert.equal(groups[0]?.length, 2);
  assert.equal(groups[1]?.length, 1);
});

test('groupForMerge returns one group when everything fits', () => {
  const partials = ['a'.repeat(40), 'b'.repeat(40)];
  const groups = groupForMerge(partials, 10_000);
  assert.equal(groups.length, 1);
  assert.equal(groups[0]?.length, 2);
});
