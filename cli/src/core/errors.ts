/**
 * CliError — every user-facing failure is one of these (TRD §15).
 * main() maps `exitCode` to the process exit code and prints `message`
 * (plus `hint` when set). Stack traces only with CONTEXT_SHIFTER_DEBUG=1.
 */

export const EXIT = {
  OK: 0,
  UNEXPECTED: 1,
  USAGE: 2,
  UNREACHABLE: 3,
  AUTH: 4,
  VALIDATION: 5,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

export class CliError extends Error {
  /** Exit code this error maps to (TRD §4.5). */
  readonly exitCode: ExitCode;
  /** Actionable next step printed as "hint: …", e.g. "ollama serve". */
  readonly hint?: string;

  constructor(exitCode: ExitCode, message: string, hint?: string) {
    super(message);
    this.name = 'CliError';
    this.exitCode = exitCode;
    this.hint = hint;
  }

  static usage(message: string, hint?: string): CliError {
    return new CliError(EXIT.USAGE, message, hint);
  }

  static unreachable(message: string, hint?: string): CliError {
    return new CliError(EXIT.UNREACHABLE, message, hint);
  }

  static auth(message: string, hint?: string): CliError {
    return new CliError(EXIT.AUTH, message, hint);
  }

  static validation(message: string, hint?: string): CliError {
    return new CliError(EXIT.VALIDATION, message, hint);
  }
}
