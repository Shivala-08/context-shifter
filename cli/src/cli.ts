/**
 * Argument parsing + dispatch (TRD §4). No commander/yargs — node:util
 * parseArgs. stdout carries only the card; errors print as
 * `error: …` (+ optional `hint: …`) and map to the exit-code contract.
 */

import { parseArgs } from 'node:util';
import { createBackend, resolveBackendId } from './backends/index.js';
import { cardSpecVersion, isLevel, requirePromptLoaded } from './core/prompt.js';
import { CliError, EXIT } from './core/errors.js';
import { runDoctor } from './commands/doctor.js';
import { runModels } from './commands/models.js';
import { runExtract } from './commands/extract.js';
import { VERSION } from './version.js';

function usage(): string {
  return `context-shifter v${VERSION} — turn a conversation into a portable context card.

Usage:
  pbpaste | context-shifter extract            extract from stdin
  context-shifter extract transcript.txt       extract from a file
  context-shifter extract --backend anthropic  pick a backend (ollama|anthropic|nim)
  context-shifter doctor                       sanity-check the setup
  context-shifter models                       list local Ollama models

Options:
  --backend <name>   ollama (default, local & free) | anthropic | nim
  --model <name>     Model override (default: qwen3:8b for Ollama; backend-specific otherwise)
  --host <url>       Ollama host override (default: OLLAMA_HOST env or http://127.0.0.1:11434)
  --level <name>     full | balanced (default) | minimal — same semantics as the Mac app
  --out <file>       Also write the card to a file
  --copy             Also copy the card to the clipboard (pbcopy / Set-Clipboard / wl-copy / xclip)
  --offline          Refuse any non-loopback backend — guarantees zero network calls
  --ctx <tokens>     Raise the Ollama context window (default 8192) — scales the chunk budget
  --max-input <bytes>  Input size guard (default 10485760)
  --quiet            Suppress stats/progress on stderr
  --help, -h         Show this help
  --version, -v      Show version

Environment:
  OLLAMA_HOST              Ollama host (default http://127.0.0.1:11434)
  ANTHROPIC_API_KEY        Required for --backend anthropic
  NVIDIA_API_KEY           Required for --backend nim (NVIDIA_NIM_API_KEY accepted)
  NIM_BASE_URL             NIM endpoint override (default https://integrate.api.nvidia.com/v1)
  CONTEXT_SHIFTER_BACKEND / _MODEL / _LEVEL   Defaults when flags are absent

The card goes to stdout; stats and warnings go to stderr — safe to pipe:
  pbpaste | context-shifter extract --copy`;
}

export interface ParsedCli {
  command: 'extract' | 'doctor' | 'models' | 'help' | 'version';
  file?: string;
  backend?: string;
  model?: string;
  host?: string;
  level: string;
  copy: boolean;
  out?: string;
  offline: boolean;
  quiet: boolean;
  ctx?: number;
  maxInputBytes?: number;
}

const LEVEL_DEFAULT = 'balanced';

/** Pure arg mapping — unit-tested; parseArgs errors become CliError(2). */
export function parseArgsTo(args: readonly string[]): ParsedCli {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...args],
      options: {
        extract: { type: 'boolean' },            // hidden compat alias (PRD F1)
        capture: { type: 'boolean' },            // hidden: refused, macOS-only
        backend: { type: 'string' },
        model: { type: 'string' },
        host: { type: 'string' },
        level: { type: 'string' },
        out: { type: 'string' },
        copy: { type: 'boolean', default: false },
        offline: { type: 'boolean', default: false },
        quiet: { type: 'boolean', default: false },
        ctx: { type: 'string' },
        'max-input': { type: 'string' },
        // Accepted for portability; the CLI currently emits no ANSI anywhere,
        // and stderr output honours NO_COLOR implicitly by staying plain.
        'no-color': { type: 'boolean' },
        help: { type: 'boolean', short: 'h', default: false },
        version: { type: 'boolean', short: 'v', default: false },
      },
      allowPositionals: true,
      strict: true,
    });
  } catch (err) {
    throw new CliError(EXIT.USAGE, err instanceof Error ? err.message : String(err), 'see: context-shifter --help');
  }

  const values = parsed.values;
  const positionals = parsed.positionals;

  // --capture is intentionally NOT implemented in the CLI (PRD F1/F2).
  if (values.capture) {
    throw new CliError(
      EXIT.USAGE,
      '--capture is macOS-only; use the Context Transfer app (the CLI deliberately does not capture).'
    );
  }

  if (values.help) return { command: 'help', level: LEVEL_DEFAULT, copy: false, offline: false, quiet: false };
  if (values.version) return { command: 'version', level: LEVEL_DEFAULT, copy: false, offline: false, quiet: false };

  let command: ParsedCli['command'];
  let file: string | undefined;

  const first = positionals[0];
  if (first === 'extract' || first === 'doctor' || first === 'models') {
    command = first;
    file = positionals[1];
  } else if (first === 'config') {
    throw new CliError(
      EXIT.USAGE,
      '`config` management ships in v0.2 (PRD R23). For now: use --backend/--model/--level flags or CONTEXT_SHIFTER_* env vars.'
    );
  } else if (first === undefined) {
    // Default command when input is piped or --extract is present (TRD §4.1);
    // `--extract file` also lands here with file = positionals[0].
    command = 'extract';
    if (values.extract && positionals.length > 0) file = positionals[0];
  } else {
    // `context-shifter transcript.txt` — file positional without the command.
    command = 'extract';
    file = first;
  }

  if (positionals.length > (first === undefined ? (values.extract ? 1 : 0) : 2)) {
    throw new CliError(
      EXIT.USAGE,
      `Unexpected argument(s): ${positionals.slice(first === undefined ? 1 : 2).join(' ')}.`,
      'see: context-shifter --help'
    );
  }

  let ctx: number | undefined;
  if (values.ctx !== undefined) {
    ctx = Number(values.ctx);
    if (!Number.isFinite(ctx) || ctx < 1024) {
      throw new CliError(EXIT.USAGE, `Invalid --ctx "${values.ctx}" — must be a token count >= 1024.`);
    }
  }

  let maxInputBytes: number | undefined;
  if (values['max-input'] !== undefined) {
    maxInputBytes = Number(values['max-input']);
    if (!Number.isFinite(maxInputBytes) || maxInputBytes <= 0) {
      throw new CliError(EXIT.USAGE, `Invalid --max-input "${values['max-input']}" — must be a byte count.`);
    }
  }

  const level = values.level ?? process.env.CONTEXT_SHIFTER_LEVEL ?? LEVEL_DEFAULT;
  if (!isLevel(level)) {
    throw new CliError(EXIT.USAGE, `Invalid --level "${level}". Valid: full, balanced, minimal.`);
  }

  return {
    command,
    file,
    backend: values.backend ?? process.env.CONTEXT_SHIFTER_BACKEND,
    model: values.model ?? process.env.CONTEXT_SHIFTER_MODEL,
    host: values.host,
    level,
    copy: values.copy ?? false,
    out: values.out,
    offline: values.offline ?? false,
    quiet: values.quiet ?? false,
    ctx,
    maxInputBytes,
  };
}

// SIGINT aborts in-flight requests (TRD §15) and exits 130 with no partial
// stdout — the card is written in one write() at the end, so nothing partial
// can leak.
const abortController = new AbortController();
process.on('SIGINT', () => {
  abortController.abort();
  process.exit(130);
});

// Broken pipe (e.g. `| head`) — exit quietly (TRD §15).
process.stdout.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EPIPE') process.exit(0);
  throw err;
});

async function dispatch(parsed: ParsedCli): Promise<number> {
  switch (parsed.command) {
    case 'help':
      process.stdout.write(usage() + '\n');
      return EXIT.OK;
    case 'version':
      process.stdout.write(`context-shifter ${VERSION} (card spec ${cardSpecVersion()})\n`);
      return EXIT.OK;
    case 'doctor':
      return runDoctor();
    case 'models':
      return runModels(parsed.host);
    case 'extract': {
      requirePromptLoaded();
      const backend = createBackend(resolveBackendId(parsed.backend), {
        host: parsed.host,
        model: parsed.model,
        ctx: parsed.ctx,
      });
      return runExtract({
        file: parsed.file,
        level: parsed.level,
        backend,
        offline: parsed.offline,
        quiet: parsed.quiet,
        copy: parsed.copy,
        out: parsed.out,
        maxInputBytes: parsed.maxInputBytes,
        signal: abortController.signal,
      });
    }
  }
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  try {
    process.exitCode = await dispatch(parseArgsTo(argv));
  } catch (err) {
    if (err instanceof CliError) {
      process.stderr.write(`error: ${err.message}\n`);
      if (err.hint) process.stderr.write(`hint: ${err.hint}\n`);
      process.exitCode = err.exitCode;
      return;
    }
    process.stderr.write(`error: ${err instanceof Error ? err.message : String(err)}\n`);
    if (process.env.CONTEXT_SHIFTER_DEBUG === '1' && err instanceof Error && err.stack) {
      process.stderr.write(err.stack + '\n');
    }
    process.exitCode = EXIT.UNEXPECTED;
  }
  // Deliberately NOT process.exit(): setting exitCode lets queued stdout
  // writes flush before the event loop drains (pipes truncate otherwise).
}
