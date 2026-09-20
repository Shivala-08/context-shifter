/**
 * User config file (PRD R23, TRD §4.3) — non-secret defaults only
 * (backend / model / level). Precedence is flags > environment > this file
 * > built-in defaults; API keys are env-only by design (PRD R12), so key-like
 * config keys are rejected here — a config file can never carry a secret.
 */

import fs from 'node:fs';
import path from 'node:path';
import { CliError, EXIT } from './errors.js';
import { isLevel } from './prompt.js';
import { BACKEND_IDS } from '../backends/index.js';
import { configFilePath } from '../io/paths.js';

export const CONFIG_KEYS = ['backend', 'model', 'level'] as const;
export type ConfigKey = (typeof CONFIG_KEYS)[number];

export interface FileConfig {
  backend?: string;
  model?: string;
  level?: string;
}

function isConfigKey(value: string): value is ConfigKey {
  return (CONFIG_KEYS as readonly string[]).includes(value);
}

/** Usage error for unknown keys — with a hint naming the valid ones. */
export function requireConfigKey(key: string): ConfigKey {
  if (!isConfigKey(key)) {
    throw new CliError(
      EXIT.USAGE,
      `Unknown config key "${key}".`,
      `valid keys: ${CONFIG_KEYS.join(', ')}. API keys are env-only by design (ANTHROPIC_API_KEY / NVIDIA_API_KEY).`
    );
  }
  return key;
}

/** Validates one value against its key's rules; throws CliError(2) on junk. */
export function validateConfigValue(key: ConfigKey, value: string): void {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new CliError(EXIT.USAGE, `Config value for "${key}" cannot be empty.`, 'unset it instead: config set ' + key + ' is not supported — delete the config file at config path.');
  }
  if (key === 'level' && !isLevel(trimmed)) {
    throw new CliError(EXIT.USAGE, `Invalid level "${trimmed}".`, 'valid levels: full, balanced, minimal.');
  }
  if (key === 'backend' && !(BACKEND_IDS as readonly string[]).includes(trimmed.toLowerCase())) {
    throw new CliError(EXIT.USAGE, `Invalid backend "${trimmed}".`, `valid backends: ${BACKEND_IDS.join(', ')}.`);
  }
}

export interface LoadedConfig {
  config: FileConfig;
  /** Set when the file exists but couldn't be used — surfaced on stderr. */
  warning?: string;
}

/**
 * Reads the config file. A missing file is the normal case (empty config);
 * corrupt JSON or a non-object yields a warning instead of a hard failure —
 * a broken defaults file should not brick extraction.
 */
export function loadConfigFile(filePath: string = configFilePath()): LoadedConfig {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch {
    return { config: {} };
  }
  try {
    const data = JSON.parse(raw) as unknown;
    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
      return { config: {}, warning: `config file ${filePath} is not a JSON object — ignoring it.` };
    }
    const config: FileConfig = {};
    for (const key of CONFIG_KEYS) {
      const value = (data as Record<string, unknown>)[key];
      if (typeof value === 'string' && value.trim()) config[key] = value.trim();
    }
    return { config };
  } catch {
    return { config: {}, warning: `config file ${filePath} is not valid JSON — ignoring it.` };
  }
}

/** Merges `patch` into the config file, creating the directory if needed. */
export function saveConfigFile(patch: Partial<FileConfig>, filePath: string = configFilePath()): FileConfig {
  const current = loadConfigFile(filePath).config;
  const merged: FileConfig = { ...current, ...patch };
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  // 0600 on POSIX — nothing secret lives here, but defaults files have no
  // reason to be world-readable. Windows ignores the mode.
  fs.writeFileSync(filePath, JSON.stringify(merged, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
  return merged;
}
