# v0.1.0 — First public release

Context Transfer is a native macOS menu bar app that turns any LLM or app conversation into a portable context card you can paste into a new session to resume work.

## Highlights

- Global capture shortcut (⌘⇧X by default, re-recordable) with built-in hotkey collision check
- Extraction via **local Ollama** (default, private, free) or **cloud Anthropic** — your API key, stored in the macOS Keychain
- Floating, non-activating result panel near the cursor; dismiss with Esc, click-away, or Copy
- Output validation with one automatic retry, plus a visible warning if the model returns a malformed card
- Exclusion list so capture never reads from password managers or secret stores
- Original clipboard contents restored after every capture
- Launch-at-login support; zero third-party dependencies

## Requirements

- macOS 13+
- For local extraction: [Ollama](https://ollama.com) installed and running, with a model pulled
- For cloud extraction: your own Anthropic API key

## Installing

This release is **source-only** — build it yourself:

```bash
git clone https://github.com/Shivala-08/context-shifter.git
cd context-shifter
./Scripts/build-app.sh
open ".build/app/Context Transfer.app"
```

A signed, notarized `.dmg` is planned for a future release.
