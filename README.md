# Context Transfer

A native macOS **menu bar** app that turns LLM/app conversations into a portable **context card** (Goal, Key Decisions, Constraints & Preferences, Current State, Open Questions) you can paste into a different session/app to resume work there.

Two ways to use it:

1. **Quick capture** (Phase 2) — select text in *any* app, press the global shortcut (⌘⇧X by default), and a floating panel appears with the extracted card and a Copy button. Your clipboard is preserved.
2. **Paste-in window** (Phase 1) — open the paste-in window from the menu bar, paste a conversation, press Extract (⌘↩).

## Features

- Menu bar agent: no Dock icon, no window on launch — lives in the menu bar
- Optional **launch at login** (Settings → General) so capture is ready after every reboot
- Malformed model output is flagged with a "Review before using" panel state instead of silently passing as a clean card
- Global capture shortcut (default ⌘⇧X, re-recordable in Settings, with a "Test shortcut" collision check)
- Capture via synthetic ⌘C — no manual copying; original clipboard restored after extraction
- Capture is **skipped entirely** in excluded apps (1Password, Keychain Access, plus any bundle ID you add in Settings) so a stray hotkey press can never grab a password field
- Floating, non-activating result panel near the cursor (or a fixed corner) with Copy / dismiss (Esc, click-away, or re-press the shortcut)
- Two interchangeable extraction backends:
  - **Cloud (Anthropic)** — `claude-sonnet-4-6`; needs your own API key
  - **Local (Ollama)** — default `qwen3:8b`; free and private, with a model list fetched from your Ollama install
- Settings persist across restarts; the backend is rebuilt from settings on every extraction

## Requirements

- macOS 13+
- Swift 5.9+ toolchain (Xcode or Command Line Tools)
- **Accessibility permission** (for the global shortcut + synthetic ⌘C) — prompted on first capture attempt
- App Sandbox **disabled** (required for `CGEvent` keystroke synthesis and global event monitoring — see TRD.md; this means App Store distribution is off the table, same model as Raycast/Alfred)

## Build & run

```bash
./Scripts/build-app.sh
open ".build/app/Context Transfer.app"
```

A `→ ←` icon appears in your menu bar. Use its menu for **Quick Capture**, the **Paste-in Window**, **Settings…**, and **Quit**.

## Choosing a backend

### Cloud — Anthropic API

1. Create an API key at [console.anthropic.com](https://console.anthropic.com).
2. Menu bar → **Settings…** → Backend: **Cloud (Anthropic)** → paste the key.
3. The key is stored in your **Keychain** (never UserDefaults/plaintext) and sent only to `api.anthropic.com`.

### Local — Ollama (default)

A fresh install uses the local backend, so the app works fully offline with no API key prompt:
1. Install Ollama: `brew install ollama`
2. Pull a model: `ollama pull qwen3:8b`
3. Start the server: `ollama serve`
4. Menu bar → **Settings…** → Backend: **Local (Ollama)** — the model list is fetched automatically (refresh button reloads it; if Ollama is unreachable you can still type a model name).

No API key required. Extraction failures show a specific, actionable error (e.g. "Couldn't reach Ollama at … Run `ollama serve` …").

## Accessibility permission (quick capture only)

The first time you press the capture shortcut, the app explains what it needs and opens **System Settings → Privacy & Security → Accessibility**. Add/toggle **ContextTransfer** there. The permission is only needed for the global-hotkey capture; the paste-in window works without it.

If the shortcut doesn't respond after granting, quit and reopen the app once (macOS sometimes applies the grant on relaunch). If it still doesn't respond, use **Settings → Test shortcut**: press the combo right after clicking — a "not detected" result means another app owns that shortcut; record a different one.

## Known limitations

- If you run a clipboard-history manager (Paste, Raycast clipboard, …), every synthetic copy still appears in that tool's history alongside intentional copies — there's no OS-level way to mark a copy as internal-only.
- Distribution outside the Mac App Store needs Developer ID signing + notarization (`Scripts/build-app.sh` accepts `SIGN_IDENTITY="Developer ID Application: …"`; then `xcrun notarytool submit` + `xcrun stapler staple`). Builds run locally via `swift build`/Xcode work ad-hoc signed.

## Phase 2 testing checklist

From TRD.md §7:

- [ ] Hotkey fires from within at least 3 different apps (browser, Notes, a code editor) with text selected
- [ ] Original clipboard contents are restored correctly after capture
- [ ] Empty selection shows a clear error, not a blank/loading panel forever
- [ ] Panel doesn't steal focus from the app the user was working in
- [ ] Accessibility permission prompt only appears once, on first real use, with a clear explanation
- [ ] Works with both backends (Anthropic + Ollama) without code changes to the capture flow

## Project layout

```
Sources/ContextTransfer/
  ContextTransferApp.swift        // @main entry; AppDelegate owns status item, hotkey, paste-in window
  ContentView.swift               // paste-in / extract / copy-out UI (Phase 1)
  SettingsView.swift              // backend picker + model list + hotkey/panel/clipboard options
  ExtractionBackend.swift         // protocol + shared system prompt + card validation/retry + response parsing
  AnthropicBackend.swift          // cloud implementation
  OllamaBackend.swift             // local implementation + /api/tags model list + num_ctx/OOM handling
  BackendFactory.swift            // settings → backend construction (shared by both flows)
  KeychainHelper.swift            // Keychain storage for the Anthropic API key (Task 4c)
  LaunchAtLogin.swift             // SMAppService launch-at-login toggle
  GlobalHotKeyManager.swift       // global + local keyDown monitors
  HotKeyCodec.swift               // persisted combo encode/decode/display
  HotKeyRecorderView.swift        // click-to-record shortcut control
  CaptureService.swift            // save clipboard → CGEvent ⌘C → poll → restore closure
  CaptureOrchestrator.swift       // end-to-end Phase 2 flow
  FloatingPanelController.swift   // non-activating NSPanel + dismiss monitors
  PanelContentView.swift          // panel UI: loading / card / error
  AccessibilityOnboarding.swift   // one-time trust check + polling
  StatusItemController.swift      // NSStatusItem menu
Resources/
  Info.plist                      // LSUIElement menu bar agent
  ContextTransfer.entitlements    // sandbox OFF (Phase 2 requirement)
Scripts/build-app.sh              // build + bundle + sign the .app
```

Phase 1 (paste-in tool) remains available via the menu bar's "Paste-in Window…" item.
