'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

/**
 * config.js computes paths from os.homedir() at require time — point HOME at
 * a temp dir and re-require fresh per test so we never touch a real
 * ~/.context-transfer.
 */
function freshConfigModule(tmpHome) {
  const previousHome = process.env.HOME;
  process.env.HOME = tmpHome;
  delete require.cache[require.resolve('../src/config')];
  const mod = require('../src/config');
  return {
    mod,
    restore: () => {
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
      delete require.cache[require.resolve('../src/config')];
    },
  };
}

function makeTmpHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ct-config-test-'));
}

test('looksLikeApiKey flags Anthropic and NVIDIA key shapes', () => {
  const { mod, restore } = freshConfigModule(makeTmpHome());
  try {
    assert.equal(mod.looksLikeApiKey('sk-ant-api03-abc'), true);
    assert.equal(mod.looksLikeApiKey('nvapi-abcdefgh'), true);
    assert.equal(mod.looksLikeApiKey('sk-1234567890'), true);
    assert.equal(mod.looksLikeApiKey('ollama'), false);
    assert.equal(mod.looksLikeApiKey('qwen3:8b'), false);
    assert.equal(mod.looksLikeApiKey(42), false);
  } finally {
    restore();
  }
});

test('loadConfig returns {} when no config file exists', () => {
  const { mod, restore } = freshConfigModule(makeTmpHome());
  try {
    assert.deepEqual(mod.loadConfig(), {});
  } finally {
    restore();
  }
});

test('loadConfig reads allowed keys and ignores unknown ones', () => {
  const home = makeTmpHome();
  const { mod, restore } = freshConfigModule(home);
  try {
    fs.mkdirSync(mod.CONFIG_DIR, { recursive: true });
    fs.writeFileSync(
      mod.CONFIG_PATH,
      JSON.stringify({ defaultBackend: 'nim', defaultModel: 'meta/llama-3.1-8b-instruct', sneaky: true })
    );
    const cfg = mod.loadConfig();
    assert.deepEqual(cfg, { defaultBackend: 'nim', defaultModel: 'meta/llama-3.1-8b-instruct' });
  } finally {
    restore();
  }
});

test('loadConfig refuses to serve a key pasted into a config field (TRD §5)', () => {
  const home = makeTmpHome();
  const { mod, restore } = freshConfigModule(home);
  try {
    fs.mkdirSync(mod.CONFIG_DIR, { recursive: true });
    fs.writeFileSync(
      mod.CONFIG_PATH,
      JSON.stringify({ defaultBackend: 'sk-ant-api03-oops', defaultModel: 'qwen3:8b' })
    );
    const cfg = mod.loadConfig();
    assert.deepEqual(cfg, { defaultModel: 'qwen3:8b' });
  } finally {
    restore();
  }
});

test('loadConfig throws a clear error on invalid JSON', () => {
  const home = makeTmpHome();
  const { mod, restore } = freshConfigModule(home);
  try {
    fs.mkdirSync(mod.CONFIG_DIR, { recursive: true });
    fs.writeFileSync(mod.CONFIG_PATH, '{not json');
    assert.throws(() => mod.loadConfig(), /not valid JSON/);
  } finally {
    restore();
  }
});

test('saveConfig writes merged config and creates the directory', () => {
  const home = makeTmpHome();
  const { mod, restore } = freshConfigModule(home);
  try {
    mod.saveConfig({ defaultBackend: 'ollama' });
    mod.saveConfig({ defaultModel: 'qwen3:8b' });
    const onDisk = JSON.parse(fs.readFileSync(mod.CONFIG_PATH, 'utf8'));
    assert.deepEqual(onDisk, { defaultBackend: 'ollama', defaultModel: 'qwen3:8b' });
  } finally {
    restore();
  }
});

test('saveConfig rejects unknown keys and key-like values', () => {
  const home = makeTmpHome();
  const { mod, restore } = freshConfigModule(home);
  try {
    assert.throws(() => mod.saveConfig({ apiKey: 'sk-ant-x' }), /Unknown config key/);
    assert.throws(() => mod.saveConfig({ defaultModel: 'nvapi-abc' }), /never store keys/);
    assert.equal(fs.existsSync(mod.CONFIG_PATH), false);
  } finally {
    restore();
  }
});
