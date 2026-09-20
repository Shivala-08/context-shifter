/**
 * `config get|list|set|path` (PRD R23) — manage the non-secret defaults in
 * the user config file (TRD §4.3). Keys: backend, model, level. Secrets stay
 * env-only (PRD R12) and are refused here by config.ts validation.
 */

import { EXIT, CliError } from '../core/errors.js';
import { CONFIG_KEYS, loadConfigFile, saveConfigFile, requireConfigKey, validateConfigValue, type ConfigKey } from '../core/config.js';
import { configFilePath } from '../io/paths.js';

const USAGE_LINES = [
  'Manage non-secret defaults (stored in the user config file).',
  '',
  'Usage:',
  '  context-shifter config list            show all keys and values',
  '  context-shifter config get <key>       show one value ("(not set)" when unset)',
  '  context-shifter config set <key> <value>',
  '  context-shifter config path            print the config file path',
  '',
  `Keys: ${CONFIG_KEYS.join(', ')}`,
  'Precedence: flags > environment (CONTEXT_SHIFTER_*) > this file > built-in defaults.',
].join('\n');

function print(line: string): void {
  process.stdout.write(line + '\n');
}

export function configUsageError(detail?: string): CliError {
  return new CliError(EXIT.USAGE, detail ?? 'Usage: context-shifter config <list|get|set|path> …', USAGE_LINES);
}

export async function runConfig(args: readonly string[]): Promise<number> {
  const [action, key, value, ...extra] = args;

  switch (action) {
    case undefined:
      throw configUsageError();

    case 'path': {
      if (key !== undefined) throw configUsageError('config path takes no arguments.');
      print(configFilePath());
      return EXIT.OK;
    }

    case 'list': {
      if (key !== undefined) throw configUsageError('config list takes no arguments.');
      const { config } = loadConfigFile();
      for (const k of CONFIG_KEYS) {
        print(`${k} = ${config[k] ?? '(not set)'}`);
      }
      return EXIT.OK;
    }

    case 'get': {
      if (!key) throw configUsageError('config get needs a key: config get <backend|model|level>.');
      const configKey = requireConfigKey(key);
      const { config } = loadConfigFile();
      print(`${configKey} = ${config[configKey] ?? '(not set)'}`);
      return EXIT.OK;
    }

    case 'set': {
      if (!key || value === undefined) {
        throw configUsageError('config set needs a key and a value: config set <key> <value>.');
      }
      if (extra.length > 0) {
        throw configUsageError(`Unexpected argument(s): ${extra.join(' ')}.`);
      }
      const configKey: ConfigKey = requireConfigKey(key);
      validateConfigValue(configKey, value);
      const filePath = configFilePath();
      saveConfigFile({ [configKey]: value.trim() }, filePath);
      print(`${configKey} = ${value.trim()}`);
      print(`saved to ${filePath}`);
      return EXIT.OK;
    }

    default:
      throw configUsageError(`Unknown config action "${action}".`);
  }
}
