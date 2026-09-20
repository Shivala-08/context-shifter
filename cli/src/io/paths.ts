/**
 * Filesystem locations (TRD §4.3): the user config file lives at
 * $XDG_CONFIG_HOME/context-shifter/config.json (fallback ~/.config/…) on
 * Linux/macOS and %APPDATA%\context-shifter\config.json on Windows.
 * The base dir is env-driven (not hard-coded per-OS) so tests can redirect it.
 */

import os from 'node:os';
import path from 'node:path';

/**
 * Base directory for the config file. `platform` is injectable so the
 * Windows branch is testable from any OS.
 */
export function configBaseDir(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string {
  if (platform === 'win32') {
    return env.APPDATA && env.APPDATA.trim() ? env.APPDATA : path.join(os.homedir(), 'AppData', 'Roaming');
  }
  const xdg = env.XDG_CONFIG_HOME?.trim();
  // XDG spec: relative paths are ignored — fall back to ~/.config.
  if (xdg && path.isAbsolute(xdg)) return xdg;
  return path.join(os.homedir(), '.config');
}

export function configFilePath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(configBaseDir(env), 'context-shifter', 'config.json');
}
