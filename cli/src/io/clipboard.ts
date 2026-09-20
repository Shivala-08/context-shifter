/**
 * Clipboard (PRD R15, TRD §11) — no dependencies; spawn the OS-native tool
 * with the card on stdin. Failure is a warning, never an error: the card
 * still goes to stdout and extraction still exits 0.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';

export type ClipboardCommand = {
  command: string;
  args: string[];
  /** Human name for doctor output. */
  label: string;
};

export function resolveClipboardCommand(): ClipboardCommand | undefined {
  return clipboardCandidates()[0];
}

/** Every plausible OS clipboard tool, best first (TRD §11). */
export function clipboardCandidates(): ClipboardCommand[] {
  if (process.platform === 'darwin') {
    return [{ command: 'pbcopy', args: [], label: 'pbcopy' }];
  }
  if (process.platform === 'win32') {
    // Set-Clipboard via PowerShell — clip.exe mangles non-ASCII (TRD §11).
    return [{
      command: 'powershell.exe',
      args: ['-NoProfile', '-Command', '[Console]::InputEncoding=[Text.Encoding]::UTF8; Set-Clipboard -Value ([Console]::In.ReadToEnd())'],
      label: 'PowerShell Set-Clipboard',
    }];
  }
  // WSL → clip.exe (before the Linux branch — WSL reports linux).
  try {
    if (fs.existsSync('/proc/version') && fs.readFileSync('/proc/version', 'utf8').toLowerCase().includes('microsoft')) {
      return [{ command: 'clip.exe', args: [], label: 'clip.exe (WSL)' }];
    }
  } catch {
    // not WSL / no procfs — keep checking
  }
  if (process.env.WAYLAND_DISPLAY) {
    return [{ command: 'wl-copy', args: [], label: 'wl-copy' }];
  }
  // X11: xclip first, xsel as the fallback.
  return [
    { command: 'xclip', args: ['-selection', 'clipboard'], label: 'xclip' },
    { command: 'xsel', args: ['--clipboard', '--input'], label: 'xsel' },
  ];
}

/** Last failure detail from a clipboard spawn — surfaced in the final warning. */
let lastClipboardError: string | undefined;

/** Spawns one clipboard command with `text` on stdin. */
function runClipboardCommand(cmd: ClipboardCommand, text: string): Promise<boolean> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(cmd.command, cmd.args, { stdio: ['pipe', 'ignore', 'pipe'] });
    } catch (err) {
      lastClipboardError = `${cmd.label}: ${err instanceof Error ? err.message : err}`;
      resolve(false);
      return;
    }
    let stderr = '';
    child.stderr?.on('data', (d) => (stderr += String(d)));
    child.on('error', (err) => {
      lastClipboardError = `${cmd.label} not available (${err.message})`;
      resolve(false);
    });
    child.on('close', (code) => {
      if (code === 0) resolve(true);
      else {
        lastClipboardError = `${cmd.label} exited ${code}${stderr ? ': ' + stderr.trim().slice(0, 120) : ''}`;
        resolve(false);
      }
    });
    child.stdin?.on('error', () => {
      /* close handler reports the failure */
    });
    child.stdin?.end(text, 'utf8');
  });
}

/**
 * Copies text to the clipboard, trying each platform tool in order. Resolves
 * to true on success; on failure resolves to false after reporting via
 * onWarning (install hint included).
 */
export async function copyToClipboard(text: string, onWarning?: (line: string) => void): Promise<boolean> {
  const candidates = clipboardCandidates();
  if (candidates.length === 0) {
    onWarning?.('No clipboard tool found — install xclip or wl-copy, or redirect stdout instead.');
    return false;
  }
  for (const cmd of candidates) {
    if (await runClipboardCommand(cmd, text)) return true;
  }
  const detail = lastClipboardError ?? 'no clipboard tool could be spawned';
  onWarning?.(`Clipboard copy failed (${detail}). Install xclip or wl-copy, or redirect stdout instead. The card is on stdout.`);
  return false;
}
