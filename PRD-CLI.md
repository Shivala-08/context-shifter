# PRD — Context Shifter CLI

| | |
|---|---|
| **Status** | Draft v0.1 |
| **Date** | 2026-09-20 |
| **Owner** | Aj (Shivala-08) |
| **Repo** | https://github.com/Shivala-08/context-shifter |
| **Lives in** | `/cli` subfolder of the existing repo |
| **Companion doc** | `TRD-CLI.md` |

---

## 1. Summary

Context Transfer (the native macOS menu bar app) turns a messy AI conversation into a portable **context card** you can paste into a fresh session. The Mac app is good and is **not changing**. This PRD defines a **cross-platform Node.js CLI** that produces the *same* card, from the same extraction prompt, on Windows, Linux and macOS, from stdin or a file.

The CLI is deliberately the "paste-in half" of the product. Global hotkey, floating panel and Accessibility-based capture stay macOS-only.

**One-line pitch:** `pbpaste | context-shifter extract` → a structured context card, on any OS, local-first.

---

## 2. Background: what exists today (repo analysis)

Analysis is based on the public README and the landing page (context-transfer.vercel.app). GitHub blocks automated fetching of `Sources/`, `Resources/` and `docs/` pages, so anything that depends on those is marked **(verify)**.

### What the Mac app already does (the parity target)

- Menu bar app, global capture shortcut, Accessibility-first capture with a ⌘C fallback, exclusion list (1Password etc.), floating result panel.
- Two backends today per the README: **Ollama (default, local)** and **Anthropic (`claude-sonnet-4-6`, key in Keychain)**. The landing page also advertises **NVIDIA NIM**.
- **Card format:** Captured on, Goal, Key Decisions, Constraints & Preferences, Current State, Resources & Links (verbatim), Open Questions.
- **Compression levels:** Full / Balanced (default) / Minimal.
- **Validation + retry:** malformed model output is retried once, then flagged for review rather than silently passed.
- **Token-reduction report** using a ~4 chars/token heuristic (e.g. `18.4k → 2.1k tokens · 89% smaller`).
- Explicit 8K context window for Ollama; model list fetched from the local Ollama install.
- Zero third-party dependencies (SwiftUI + AppKit + `URLSession`).
- MIT licence, CI badge, CONTRIBUTING / SECURITY / CODE_OF_CONDUCT, v0.1.0 tagged, source-only release.

### Findings that shape the CLI

| # | Finding | Impact on CLI |
|---|---|---|
| F1 | The landing page **already shows CLI commands** that don't exist: `pbpaste \| context-transfer --extract`, `context-transfer --capture`, `context-transfer --backend ollama`. | CLI must accept `--extract` and `--backend` as compatible spellings, or the site must change. `--capture` is macOS-only and should **not** ship in the CLI. |
| F2 | **Naming is split three ways:** repo `context-shifter`, app/site "Context Transfer", site command `context-transfer`. | Blocks the npm decision. See §7. |
| F3 | **Docs drift between README and landing page:** shortcut ⌘⇧X vs ⌘⇧E; macOS 13+ vs 14+; sample model `llama3.2:3b` vs `llama3.1:8b`; NIM only on the site; `.dmg` download on the site vs "source-only" in README; site build steps reference `ContextTransfer.xcodeproj` and `cd context-transfer`, but the repo is a Swift package (`Package.swift`, `Scripts/build-app.sh`) named `context-shifter`. | The CLI must not inherit this. One source of truth for defaults, shared with the app. |
| F4 | The prompt is described as shared between app and CLI, but a Swift package and an npm package can't read each other's files. `npm publish` only ships files inside `/cli`. | Needs a canonical prompt file plus a sync step and a drift test. See TRD §5. |
| F5 | The app has a **card-format contract in practice** (validation) but no versioned spec. | Introduce `CARD_SPEC_VERSION` and shared fixtures so two implementations can't silently diverge. |
| F6 | `OPEN_SOURCE_GUIDE.md` (listed in your notes) returns 404 in the public repo. | Probably local-only. Not a blocker; don't link to it from the CLI README. |
| F7 | Card date formats differ: landing shows "Sep 14, 2026, 11:42 PM"; your own cards use `2026-09-20`. | Spec must pick one. Recommendation: ISO 8601. |
| F8 | Ollama runs with an 8K window. Long transcripts won't fit in one pass. | CLI needs chunking + merge, not just truncation. This is the biggest functional gap versus a "simple" CLI. |

---

## 3. Problem

People who move between AI tools lose context every time. The Mac app solves this for macOS users who can capture from anywhere. Everyone else (Windows, Linux, SSH sessions, CI, people living in a terminal) has no way to get the same card, and even Mac users can't script the app.

## 4. Goals and non-goals

### Goals

1. **Same card, any OS.** Byte-compatible with the Mac app's card format and driven by the same extraction prompt.
2. **Local-first.** Ollama is the default backend; cloud is opt-in. No telemetry, no accounts.
3. **Pipe-friendly.** Works in shell pipelines: stdin/file in, card on stdout, diagnostics on stderr, meaningful exit codes.
4. **Zero-friction install.** `npx context-shifter` works with nothing pre-installed except Node and (for local mode) Ollama.
5. **Tiny and auditable.** Zero runtime dependencies (matches the app's philosophy and reduces npm supply-chain risk).
6. **Handle real transcripts.** Long conversations must work on the 8K local window via chunking.

### Non-goals

- Global hotkey, floating panel, screen or Accessibility capture, exclusion list of apps (all macOS-only, stay in the Swift app).
- A GUI, browser extension or hosted service.
- Replacing or modifying the Mac app's behaviour.
- Storing conversations. The CLI keeps no history by default.

---

## 5. Users and use cases

| Persona | Need | Example |
|---|---|---|
| **Windows / Linux user** | The app doesn't run on their OS. | Copies a ChatGPT thread, runs `context-shifter extract --copy`, pastes into Claude. |
| **Terminal-first Mac user** | Prefers keyboard/pipes, works over SSH/tmux. | `pbpaste \| context-shifter extract \| pbcopy` |
| **Scripter / power user** | Batch-process exported chats. | `context-shifter extract export.json --from chatgpt-export --json` |
| **Coding-agent user** | Hand off a long agent session to a fresh one. | `context-shifter extract session.log --level minimal --out HANDOFF.md` |

---

## 6. Requirements

Priority: **P0** = must ship in v0.1.0, **P1** = v0.2, **P2** = later.

### 6.1 Core extraction

| ID | Requirement | Pri |
|---|---|---|
| R1 | `extract` reads from stdin, a file path, or `-`. If stdin is an interactive terminal, show a paste prompt with the correct EOF key for the OS (Ctrl-D, or Ctrl-Z then Enter on Windows) instead of hanging silently. | P0 |
| R2 | Output is a context card with exactly the app's sections, in order, with a **locally generated** "Captured on" line (not model-generated). | P0 |
| R3 | Compression levels `--level full\|balanced\|minimal`, default `balanced`, semantics identical to the app. | P0 |
| R4 | Validation + one retry; if still invalid, print the card, warn on stderr, exit non-zero. Never silently pass a malformed card. | P0 |
| R5 | **Link-fidelity check:** every URL in the card's Resources & Links must appear verbatim in the input; otherwise fail validation. (Backport candidate for the app.) | P0 |
| R6 | Token-reduction stats on stderr (`18.4k → 2.1k tokens · 89% smaller`), same heuristic as the app. Suppress with `--quiet`. | P0 |
| R7 | **Chunk + merge** for inputs that exceed the backend's budget (map → reduce), splitting on turn boundaries. | P0 |
| R8 | Handle Windows stdin quirks: UTF-8 BOM, UTF-16LE from PowerShell pipes, CRLF. | P0 |

### 6.2 Backends

| ID | Requirement | Pri |
|---|---|---|
| R9 | `--backend ollama` (default). Honour `OLLAMA_HOST`. Friendly error if unreachable (`Start it with: ollama serve`). | P0 |
| R10 | `--backend anthropic`. Key from `ANTHROPIC_API_KEY`. Model overridable; default mirrors the app. | P0 |
| R11 | `--backend nim` (NVIDIA NIM hosted API). Key from `NVIDIA_API_KEY`. | P0 |
| R12 | API keys are **never** accepted as command-line flags (shell history/`ps` leakage). Env var, or optional config file with 0600 permissions. | P0 |
| R13 | `--offline` refuses any non-loopback backend, making the "0 network calls" claim enforceable and testable. | P0 |
| R14 | `models` command lists locally installed Ollama models. | P1 |

### 6.3 Output and integration

| ID | Requirement | Pri |
|---|---|---|
| R15 | `--copy` copies to clipboard using the OS's native tool (`pbcopy`, `clip`/PowerShell, `wl-copy`/`xclip`/`xsel`) with no dependency. | P0 |
| R16 | `--out <file>` writes the card to a file. | P0 |
| R17 | `--json` emits a structured object (sections as arrays, stats, backend, model, `spec_version`) alongside the markdown. | P1 |
| R18 | `--redact` scrubs obvious secrets (API keys, tokens, emails) from the input before sending to a **cloud** backend. Defaults to a warning on cloud backends when secrets are detected. | P1 |
| R19 | `--from chatgpt-export\|claude-export` parses official export JSON into a transcript first. | P1 |
| R20 | `--target generic\|claude-md\|agents-md` wraps the card as a paste-ready first message or a repo instruction file. | P2 |
| R21 | `merge` command: fold a new conversation into an existing card (latest state wins, decisions accumulate). | P2 |

### 6.4 Setup and diagnostics

| ID | Requirement | Pri |
|---|---|---|
| R22 | `doctor` checks Node version, Ollama reachability, model presence, key env vars, clipboard tool, and prints a pass/fail list. | P0 |
| R23 | `config get\|set\|list\|path` for default backend/model/level. | P1 |
| R24 | Shell completions (bash, zsh, fish, PowerShell). | P2 |

### 6.5 Distribution

| ID | Requirement | Pri |
|---|---|---|
| R25 | Published to npm from `/cli` with provenance; `npx` and global install both work. | P0 |
| R26 | CI matrix: Ubuntu, macOS, Windows × current Node LTS lines. | P0 |
| R27 | Independent CLI versioning with a shared `CARD_SPEC_VERSION` (see TRD §8). | P0 |

---

## 7. Naming and packaging (decision needed)

Both `context-shifter` and `context-transfer` returned 404 from the npm registry when checked on 2026-09-20, so **both appear available**. (npm can still reject names that are too similar to existing packages at publish time, so reserve the name early.)

**Recommendation: `context-shifter`.**

- Your rule is that the project name must match the package name. The **project is the repo**, and the repo is already `context-shifter`. The app's user-facing name ("Context Transfer") can stay a display name.
- It avoids a rename of the repo URL, existing links, the tag and the CI badge.
- Binary names: `context-shifter` (primary) and a short alias `cshift`.

**Consequence you must accept:** the landing page uses `context-transfer` in its terminal demos. Update those to `context-shifter` (a 5-minute change), and consider aligning the landing page title to "Context Shifter". If you'd rather keep "Context Transfer" as the brand everywhere, then rename the *repo* to `context-transfer` instead. The one option to avoid is a package name that differs from the repo.

Compatibility flags: `--extract` (site's spelling) is accepted as an alias for the `extract` command so the site's current examples keep working during the transition.

---

## 8. Example UX

```bash
# The 80% case
pbpaste | context-shifter extract --copy

# Windows PowerShell
Get-Clipboard | context-shifter extract --copy

# From a file, tighter card, cloud backend
context-shifter extract chat.txt --level minimal --backend anthropic

# Guaranteed-local
context-shifter extract chat.txt --offline

# Sanity check the setup
context-shifter doctor
```

Stdout is the card only. Stats, warnings and progress go to stderr, so `| pbcopy` and `> card.md` stay clean.

Exit codes: `0` ok · `1` unexpected error · `2` bad usage · `3` backend unreachable · `4` auth failure · `5` card failed validation after retry.

---

## 9. Success metrics

| Metric | Target |
|---|---|
| Fresh-machine "install → first card" on Windows, Linux, macOS | Under 5 minutes with Ollama already installed; under 1 minute with a cloud key |
| Runtime dependencies | 0 |
| Unpacked package size | Under ~150 kB |
| Card parity: shared fixtures accepted/rejected identically by the Swift and Node validators | 100% |
| CI matrix green on all three OSes | Required for every release |
| Long-transcript success (≥ 100k chars on an 8K local model) | Completes and passes validation on the fixture set |

Adoption numbers (stars, npm downloads) are worth watching but not gating; the repo is at 0 stars today, so early feedback will come from direct sharing rather than organic discovery.

---

## 10. Release plan

| Milestone | Scope |
|---|---|
| **M0: Foundations** | Decide name; reserve npm name; create `/shared` (prompt, card spec, fixtures); scaffold `/cli`; CI workflow with path filters. |
| **M1: Core** | R1–R6, R9, R15, R16, R22. Ollama only. Usable end-to-end. |
| **M2: Backends + robustness** | R10–R13, R7 (chunking), R8 (Windows encoding). |
| **M3: Ship v0.1.0** | R25–R27, README, landing page update, npm publish with provenance. |
| **M4: v0.2** | R14, R17–R19, R23. |

---

## 11. Risks

| Risk | Mitigation |
|---|---|
| Small local models produce poor cards | Validation + retry, link-fidelity check, recommend a ≥8B model in `doctor` output. |
| Chunk-merge loses or duplicates decisions | Golden fixtures with known decisions; merge prompt tuned for "latest state wins"; test on long transcripts. |
| Prompt drift between app and CLI | Single canonical file, sync on prepack, CI fails on any difference. |
| Windows encoding / clipboard bugs | Explicit BOM/UTF-16 handling; Windows in CI matrix from day one. |
| Secrets sent to cloud accidentally | `--redact`, warnings, `--offline`, no key flags. |
| npm supply-chain trust | Zero runtime deps, provenance publishing, 2FA on the npm account. |
| Docs drift continues (F3) | Defaults live in one spec file; README and site generated from or checked against it. |

---

## 12. Decisions and open questions

| # | Question | Recommendation | Status |
|---|---|---|---|
| D1 | `context-transfer` or `context-shifter`? | `context-shifter` (matches repo); update site demos. | **Needs your call** |
| D2 | What ships beyond core extraction? | P0/P1 list in §6. Highest-value extras: chunking (R7), link-fidelity check (R5), `--offline` (R13), `--from chatgpt-export` (R19). | Proposed |
| D3 | How to version the app and CLI? | Independent semver each (`v*` for the app, `cli-v*` for the CLI) plus a shared `CARD_SPEC_VERSION`. Bump the spec only on breaking card-format changes. | Proposed |
| D4 | Date format in cards | ISO 8601 with local offset. | Proposed |
| D5 | Should the app adopt the CLI's link-fidelity check? | Yes, as a follow-up; it's a small Swift change with a clear quality win. | Later |
| D6 | Default Anthropic model | Mirror the app (`claude-sonnet-4-6` per README). Newer Sonnet IDs exist, so decide whether the app and CLI move together. | Open |
