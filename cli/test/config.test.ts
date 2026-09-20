import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { configBaseDir, configFilePath } from '../src/io/paths.js';
import { CONFIG_KEYS, loadConfigFile, saveConfigFile, requireConfigKey, validateConfigValue } from '../src/core/config.js';
import { runConfig } from '../src/commands/config.js';
import { CliError } from '../src/core/errors.js';

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cshift-config-'));
}

test('configFilePath honours an absolute XDG_CONFIG_HOME', () => {
  const xdg = tempDir();
  const file = configFilePath({ XDG_CONFIG_HOME: xdg });
  assert.equal(file, path.join(xdg, 'context-shifter', 'config.json'));
});

test('a relative XDG_CONFIG_HOME is ignored per the XDG spec', () => {
  const file = configFilePath({ XDG_CONFIG_HOME: 'relative/path' });
  assert.ok(path.isAbsolute(file));
  assert.ok(file.endsWith(path.join('.config', 'context-shifter', 'config.json')));
});

test('configBaseDir uses APPDATA on win32 (and falls back without it)', () => {
  const dir = configBaseDir({ APPDATA: 'C:\\Users\\x\\Roaming' } as NodeJS.ProcessEnv, 'win32');
  assert.equal(dir, 'C:\\Users\\x\\Roaming');
  const fallback = configBaseDir({} as NodeJS.ProcessEnv, 'win32');
  assert.ok(fallback.endsWith(path.join('AppData', 'Roaming')));
});

test('a missing config file is the normal empty case', () => {
  const loaded = loadConfigFile(path.join(tempDir(), 'nope.json'));
  assert.deepEqual(loaded.config, {});
  assert.equal(loaded.warning, undefined);
});

test('save + load round-trips and merges keys', () => {
  const file = path.join(tempDir(), 'context-shifter', 'config.json');
  saveConfigFile({ backend: 'anthropic' }, file);
  const second = saveConfigFile({ level: 'minimal' }, file);
  assert.equal(second.backend, 'anthropic');
  assert.equal(second.level, 'minimal');
  const loaded = loadConfigFile(file);
  assert.equal(loaded.warning, undefined);
  assert.deepEqual(loaded.config, { backend: 'anthropic', level: 'minimal' });
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  }
});

test('corrupt or non-object config files warn and are ignored', () => {
  const dir = tempDir();
  const bad = path.join(dir, 'bad.json');
  fs.writeFileSync(bad, '{not json', 'utf8');
  assert.ok(loadConfigFile(bad).warning?.includes('not valid JSON'));
  const array = path.join(dir, 'arr.json');
  fs.writeFileSync(array, '[]', 'utf8');
  assert.ok(loadConfigFile(array).warning?.includes('not a JSON object'));
});

test('unknown keys and secret-shaped keys are refused', () => {
  assert.throws(() => requireConfigKey('api_key'), (err: unknown) => err instanceof CliError && err.exitCode === 2);
  assert.throws(() => requireConfigKey('anthropic_api_key'), (err: unknown) => err instanceof CliError && err.exitCode === 2);
});

test('values are validated: level and backend are constrained, values cannot be empty', () => {
  assert.throws(() => validateConfigValue('level', 'turbo'), (err: unknown) => err instanceof CliError && err.exitCode === 2);
  assert.throws(() => validateConfigValue('backend', 'gemini'), (err: unknown) => err instanceof CliError && err.exitCode === 2);
  assert.throws(() => validateConfigValue('model', '   '), (err: unknown) => err instanceof CliError);
  assert.doesNotThrow(() => validateConfigValue('backend', 'nim'));
  assert.doesNotThrow(() => validateConfigValue('backend', 'openai'));
  assert.doesNotThrow(() => validateConfigValue('backend', 'openrouter'));
  assert.doesNotThrow(() => validateConfigValue('model', 'qwen3:8b'));
});

test('runConfig: get/list/path work against an explicit (empty) home and set writes', async () => {
  const dir = tempDir();
  const env = { XDG_CONFIG_HOME: dir } as NodeJS.ProcessEnv;
  const file = configFilePath(env);
  const saved = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = dir;
  try {
    assert.equal(await runConfig(['path']), 0);
    assert.equal(await runConfig(['get', 'backend']), 0);
    assert.equal(await runConfig(['list']), 0);
    assert.equal(await runConfig(['set', 'level', 'full']), 0);
    const onDisk = JSON.parse(fs.readFileSync(file, 'utf8')) as { level?: string };
    assert.equal(onDisk.level, 'full');
  } finally {
    if (saved === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = saved;
  }
});

test('runConfig: bad action, bad key, missing value and extra args are usage errors', async () => {
  await assert.rejects(() => runConfig(['fly']), (err: unknown) => err instanceof CliError && err.exitCode === 2);
  await assert.rejects(() => runConfig(['get']), (err: unknown) => err instanceof CliError && err.exitCode === 2);
  await assert.rejects(() => runConfig(['get', 'secret']), (err: unknown) => err instanceof CliError && err.exitCode === 2);
  await assert.rejects(() => runConfig(['set', 'level']), (err: unknown) => err instanceof CliError && err.exitCode === 2);
  await assert.rejects(() => runConfig(['set', 'level', 'full', 'extra']), (err: unknown) => err instanceof CliError && err.exitCode === 2);
  await assert.rejects(() => runConfig(['set', 'level', 'turbo']), (err: unknown) => err instanceof CliError && err.exitCode === 2);
});

test('CONFIG_KEYS covers exactly the three non-secret defaults', () => {
  assert.deepEqual([...CONFIG_KEYS], ['backend', 'model', 'level']);
});
