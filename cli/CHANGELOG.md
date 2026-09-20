# Changelog — context-shifter (CLI)

All notable changes to the CLI package (`/cli`) are documented here.
The CLI is versioned independently of the macOS app (`cli-vX.Y.Z` tags); the
card format is a separate shared contract (`CARD_SPEC_VERSION`) documented in
[`shared/card-spec.md`](../shared/card-spec.md).

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.1] - 2026-09-20

First release shipped through CI with npm **provenance** (OIDC trusted
publishing) — the bootstrap reserved the name with a manual 0.1.0 publish, as
planned in [PUBLISHING.md](PUBLISHING.md). No functional changes to extraction.

### Fixed

- **Windows CI green** — runners check out with `core.autocrlf=true`, so the
  shared extraction prompt arrived as CRLF and both front-matter parsers
  (hard-coded to LF) rejected it. `.gitattributes` now enforces LF repo-wide
  (the prompt's sha256 drift contract must be OS-independent), the parsers
  normalize CRLF as defence in depth, and `parsePromptFile` is pinned by CRLF
  regression tests.
- **Config-path tests pass on Windows** — `configBaseDir`/`configFilePath`
  take an injectable `platform` so the `%APPDATA%` branch is testable from any
  OS; the suite no longer depends on which platform it runs on.

## [0.1.0] - 2026-09-20

First release. Turns a pasted or piped AI conversation into a portable context
card — same prompt, same card format, and same validation as the Context
Transfer macOS app, on Windows, Linux and macOS. Zero runtime dependencies.

### Added

- **`extract` command** — reads a file path, `-`, or piped stdin; an
  interactive TTY gets a paste prompt with the OS-correct EOF key
  (`Ctrl-D`, or `Ctrl-Z` then Enter on Windows). Empty input and oversize
  input (10 MB guard, `--max-input`) are usage errors.
- **Five backends** — `ollama` (default, local & free), `anthropic`,
  `nim` (NVIDIA NIM), plus `openai` and `openrouter` presets on the same
  OpenAI-compatible client layer. Default models: `qwen3:8b`,
  `claude-sonnet-4-6`, `meta/llama-3.1-8b-instruct`, `gpt-4o-mini` (OpenAI),
  `openai/gpt-4o-mini` (OpenRouter); override with `--model`. OpenRouter
  unlocks hundreds of models via `vendor/model` ids with one key; newer
  OpenAI reasoning models that reject `max_tokens` get an automatic
  `max_completion_tokens` retry. Ollama's context window is always set
  explicitly (`num_ctx`, `--ctx`) so long prompts are never silently
  truncated.
- **Compression levels** `--level full|balanced|minimal` (default
  `balanced`) with the same semantics as the Mac app.
- **Card validation + one retry** against the shared card spec: all six
  sections in order, no empty sections, and a link-fidelity check
  (`FABRICATED_URL`) — every URL in Resources & Links must appear verbatim in
  the input. On a second failure the card is still printed, a warning goes to
  stderr, and the exit code is 5. Malformed cards are never silently passed.
- **Chunk + merge** for inputs that exceed the backend budget: turn-boundary
  splitting (speaker labels → paragraphs → lines, never inside a code fence),
  greedy packing with overlap, map at `full` level, reduce at the requested
  level, validation on the final card only.
- **Output & integration** — `--copy` (pbcopy / Set-Clipboard / wl-copy /
  xclip / xsel, no dependency), `--out <file>`, `--quiet`. stdout carries the
  card only; stats, warnings and progress go to stderr.
- **`--json`** (R17) — structured output to stdout: the full card, sections as
  line arrays, token stats, backend, model, level, `spec_version`, the
  validation verdict and any redaction report. `--out`/`--copy` still operate
  on the markdown card.
- **`--redact`** (R18) — scrubs obvious secrets before anything is sent:
  Anthropic/generic API keys, NVIDIA keys, GitHub and Slack tokens, AWS access
  key IDs, JWTs, `Bearer` headers, PEM private-key blocks — each replaced with
  `[REDACTED:type]`. On cloud backends without `--redact`, detected secrets
  produce a stderr warning; local backends stay silent. Link fidelity checks
  the redacted text so redaction can't cause false validation failures.
- **`--from chatgpt-export\|claude-export`** (R19) — parses the official
  `conversations.json` data exports into a transcript first. The most recently
  updated conversation in an array is converted (with a note); malformed
  input is a usage error with a hint.
- **Token-reduction stats** on stderr (`18.4k → 2.1k tokens · 89% smaller`)
  using real API usage when reported, else the ~4 chars/token heuristic.
- **`--offline`** — refuses any non-loopback backend before any network I/O,
  making the zero-network-call claim enforceable and tested.
- **`doctor`** — Node version, Ollama reachability, model pulled (with a
  small-model warning below 8B), cloud keys, clipboard tool.
- **`models`** — lists locally installed Ollama models.
- **`config list\|get\|set\|path`** (R23) — non-secret defaults
  (`backend`/`model`/`level`) stored at the platform config location.
  Precedence: flags > environment > config file > built-in defaults. API keys
  remain env-only and are refused as config keys.
- **Windows/PowerShell robustness** — UTF-8 BOM, UTF-16LE/BE detection
  (BOM or 0x00-at-odd-offsets), CRLF normalization, ANSI escape stripping.
- **Exit-code contract** — `0` ok · `1` unexpected · `2` usage · `3` backend
  unreachable · `4` auth failure · `5` validation failed after retry.
- **`--extract` compat alias** so the landing page's
  `pbpaste | context-transfer --extract` spelling keeps working; `--capture`
  is deliberately refused with a macOS-app hint.
- **Shared prompt + card spec** — the canonical extraction prompt and card
  format live in `shared/`; the CLI's copy is generated on build and CI fails
  on drift. Shared pass/fail fixtures are asserted in both implementations.

### Security

- **API keys are never command-line flags** (shell history / `ps` leakage);
  env vars only (`ANTHROPIC_API_KEY`, `NVIDIA_API_KEY`, `OPENAI_API_KEY`,
  `OPENROUTER_API_KEY`).
- **Local-first by default** — Ollama is the default backend; the CLI
  performs no telemetry and no update checks, ever.
- **Zero runtime dependencies** — the supply-chain surface is TypeScript and
  `@types/node` at build time, nothing at runtime.

[0.1.0]: https://github.com/Shivala-08/context-shifter/releases/tag/cli-v0.1.0
[0.1.1]: https://github.com/Shivala-08/context-shifter/releases/tag/cli-v0.1.1
