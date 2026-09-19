# PRD — Context Transfer CLI

## 1. Purpose
A cross-platform command-line companion to the macOS app. Same core idea — turn a conversation into a portable, structured context card — available to anyone on any OS via `npx`, without needing to install a native app or own a Mac.

## 2. Relationship to the macOS app
This is **not** a port of the full app — it's the Phase 1 extraction functionality only, in a different shape. Explicitly out of scope:
- No global hotkey / system-wide capture (that's macOS Accessibility API territory, not portable to Node)
- No floating panel or any GUI — this is a terminal tool, output is text
- No menu bar presence

What it shares with the Mac app: the exact same extraction template (Captured on / Goal / Key Decisions / Constraints & Preferences / Current State / Resources & Links / Open Questions) and the same three backend options (local Ollama, Anthropic, NVIDIA NIM), so a card produced by either tool looks identical and either one can be used interchangeably depending on what's on hand.

## 3. Audience
- Developers on Windows/Linux who can't use the Mac app at all
- Mac users who want a fast, scriptable option (e.g. piping output into other tools) without opening a GUI
- Anyone evaluating the project who wants to try it in 10 seconds via `npx` before deciding whether to install the full app

## 4. Core user stories
- As a user, I can pipe clipboard or file contents into the CLI and get a structured card printed to my terminal.
- As a user, I can choose which backend to use (local Ollama by default, or a cloud key I've set as an environment variable) without editing any config file.
- As a user, I can run this via `npx context-transfer` without a global install, and get the same result as if I'd installed it.
- As a user, if my API key isn't set and I try to use a cloud backend, I get a clear message telling me exactly which environment variable to set — not a stack trace.

## 5. Feature scope (v1)
- Read input from **stdin** (pipe) or a **`--file <path>`** flag
- **`--backend <ollama|anthropic|nim>`** flag, defaulting to `ollama`
- **`--model <name>`** flag, defaulting to `qwen3:8b` for Ollama
- Print the resulting card to stdout (so it composes naturally with shell pipelines — e.g. `... | pbcopy` on Mac, `... | clip` on Windows)
- **`--json`** flag as an alternate output mode (structured JSON instead of markdown), for anyone scripting against it rather than reading it directly

## 6. Explicit non-goals (v1)
- No persistent history of past extractions
- No interactive/TUI mode — flags and stdin only
- No Windows/Linux global-capture equivalent — if that gets built later, it's a separate, much bigger effort (e.g. platform-specific accessibility APIs per OS) and not part of this scope

## 7. Success criteria
- Installable and runnable via `npx context-transfer` with zero global install step
- Output is byte-for-byte structurally identical in format to the Mac app's cards (same headers, same order) so the two tools feel like one product, not two different things that happen to share a name
- Works with no API key at all as long as Ollama is running locally — the "no cost, no signup, try it immediately" path has to work out of the box

## 8. Risks
- **Prompt drift**: the extraction system prompt lives in two codebases (Swift and Node) with no shared source. If one gets updated and the other doesn't, the two tools produce different card formats over time — see TRD for the mitigation.
- **npm name squatting**: `context-transfer` and `context-shifter` are both currently available, but confirm again immediately before publishing, since availability can change.
