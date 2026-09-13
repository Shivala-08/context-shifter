# Context Transfer

A native macOS **menu bar** app that turns LLM/app conversations into a portable **context card** — Goal, Key Decisions, Constraints & Preferences, Current State, Resources & Links, Open Questions — that you can paste into a different session or app to resume work there.

```
   ┌─────────────────────────┐
   │  Where you are now:     │
   │  chat, editor, docs     │
   └───────────┬─────────────┘
               │  select text · press ⌘⇧X
               ▼
   ┌─────────────────────────┐
   │  Context Transfer       │
   │  captures + extracts    │
   └───────────┬─────────────┘
               │  Copy
               ▼
   ┌─────────────────────────┐
   │  Where you're going:    │
   │  new session, new app   │
   └─────────────────────────┘
```

Two ways to use it:

1. **Quick capture** — select text in *any* app, press the global shortcut (⌘⇧X by default), and a floating panel appears with the extracted card and a Copy button. Your clipboard is preserved.
2. **Paste-in window** — open it from the menu bar, paste a conversation, press Extract (⌘↩).

## Features

- Menu bar agent: no Dock icon, no window on launch — lives in the menu bar (`LSUIElement`)
- Global capture shortcut (default ⌘⇧X, re-recordable) with a **"Test shortcut" collision check** in Settings
- Capture via a single synthetic ⌘C — no manual copying; original clipboard restored after extraction
- Capture is **skipped entirely** in excluded apps (1Password, Keychain Access, plus any bundle ID you add) so a stray hotkey press can never grab a password field
- Fast two-phase pasteboard poll: reacts in ~20–100ms on fast apps, keeps a grace window for slow ones instead of silently capturing stale clipboard text
- Floating, non-activating result panel near the cursor (or a fixed corner); dismisses on click-away, Esc, re-pressing the shortcut, or automatically after Copy
- Status-item icon flashes for ~1s on every successful capture — positive confirmation the hotkey did something
- Two interchangeable extraction backends behind one protocol:
  - **Local (Ollama)** — default; free and private; model list fetched from your Ollama install; explicit 8K context window
  - **Cloud (Anthropic)** — `claude-sonnet-4-6`; needs your own API key, stored in the **Keychain**
- Malformed model output is retried once, then flagged with a "Review before using" panel state instead of silently passing as a clean card
- Optional **launch at login** (Settings → General)
- Settings persist across restarts; the backend is rebuilt from settings on every extraction

## Requirements

- macOS 13+
- Swift 5.9+ toolchain (Xcode or Command Line Tools)
- **Accessibility permission** for quick capture (global shortcut + synthetic ⌘C) — prompted on first capture attempt, not at launch
- App Sandbox **disabled** — required for `CGEvent` keystroke synthesis and global event monitoring (this means App Store distribution is off the table, same model as Raycast/Alfred)
- For the local backend: [Ollama](https://ollama.com) with a model pulled

## Build & run

```bash
./Scripts/build-app.sh
open ".build/app/Context Transfer.app"
```

A `→ ←` icon appears in your menu bar. For a distributable build:

```bash
SIGN_IDENTITY="Developer ID Application: <name>" ./Scripts/build-app.sh
# then: xcrun notarytool submit … && xcrun stapler staple …
```

Skipping signing/notarization produces the classic "app is damaged and can't be opened" Gatekeeper error on a fresh install — that's Gatekeeper, not a broken build.

## Usage guide

### First run

1. Launch the app — nothing opens but the `→ ←` menu bar icon.
2. Menu bar → **Settings…** → under **Extraction backend** pick a backend:
   - *Local (Ollama)* (default): make sure Ollama is running (`ollama serve`), then click the refresh button to fetch your model list and pick one (e.g. `llama3.2:3b`). No API key needed.
   - *Cloud (Anthropic)*: paste your API key ([console.anthropic.com](https://console.anthropic.com)). It's stored in your Keychain, sent only to `api.anthropic.com`.
3. Under **Quick capture**, confirm the shortcut and click **Test shortcut**, then press the combo. If it reports "not detected," another app owns that combo — record a different one.
4. (Optional) Toggle **Launch at login**; approve it once under System Settings → General → Login Items.

### Quick capture (the main flow)

```
Select text anywhere → press ⌘⇧X → panel appears with a spinner
→ card populates → Copy → paste into the new session
```

- The panel never steals focus; keep working while it extracts.
- Dismiss it with Esc, a click anywhere outside it, pressing ⌘⇧X again — or just hit **Copy**, which copies and auto-dismisses.
- If nothing was selected, the panel says so within ~1s instead of calling the model with stale input.
- Nothing is stored: each capture is transient, and your original clipboard is restored after extraction.

### Paste-in window

Menu bar → **Paste-in Window…** → paste the conversation → **Extract Context** (⌘↩) → **Copy** the card out. Works without the Accessibility permission. Same backend settings as quick capture.

### What's in a context card

`Captured on: <date>`, then `## Goal`, `## Key Decisions`, `## Constraints & Preferences`, `## Current State`, `## Resources & Links`, `## Open Questions` — tight bullets, meant to be pasted as a first message in a new session. **Resources & Links is copied verbatim by rule** — URLs, file paths, filenames, arxiv IDs appear exactly as written, because a guessed link is worse than no link.

If the model returns a malformed card, the app retries once automatically; if it's still malformed you get an orange **"Review before using"** panel with the card below it — review, especially the links, before pasting.

## Settings reference

| Setting | What it does |
|---|---|
| Backend | Local (Ollama, default) vs Cloud (Anthropic) |
| Anthropic API key | Stored in the Keychain, never UserDefaults |
| Ollama host / model | Defaults `http://localhost:11434` + model list from `/api/tags` (free-text fallback if Ollama is unreachable) |
| Capture shortcut | Re-recordable; **Test shortcut** verifies it isn't already owned by another app |
| Restore clipboard after capture | On by default |
| Panel position | Near cursor (default) or fixed corner (any of the four) |
| Never capture from | Bundle-ID exclusion list (1Password + Keychain Access built in) |
| Launch at login | Registers the app with launchd via `SMAppService` |

## Architecture

SwiftUI + AppKit on macOS 13+. AppKit is required for the status item, the non-activating `NSPanel`, and global event monitoring; SwiftUI alone can't do these. No third-party dependencies — `URLSession` for all HTTP.

```
                    ┌─────────────────────────────┐
                    │  ContextTransferApp         │
                    │  AppDelegate owns:          │
                    │  status item · hotkey ·     │
                    │  paste-in window            │
                    └──────────┬──────────────────┘
           ⌘⇧X (global+local   │           menu clicks
           NSEvent monitors)   ▼
        ┌──────────────────────────────┐     ┌────────────────────┐
        │ GlobalHotKeyManager          │     │ StatusItemController│
        │ combo re-applied live from   │     │ idle ↔ flash icon  │
        │ Settings via Notification    │     └────────────────────┘
        └──────────────┬───────────────┘
                       ▼
        ┌──────────────────────────────┐
        │ CaptureOrchestrator (@MainActor)│  state machine for the cycle:
        │ exclusion check FIRST → panel │  capturing / dismissed-during-
        │ with spinner → extract → show │  capture / idle
        └──────┬───────────────┬───────┘
               ▼               ▼
   ┌───────────────────┐  ┌──────────────────────────────┐
   │ CaptureService    │  │ FloatingPanelController      │
   │ (off main thread) │  │ non-activating floating NSPanel│
   │ 1. exclusions     │  │ loading / success / needsReview│
   │ 2. snapshot pasteboard│ /failure states, hosted via   │
   │ 3. CGEvent ⌘C     │  │ NSHostingView                 │
   │ 4. two-phase poll │  └──────────────────────────────┘
   │    20ms×0.5s → 60ms│
   │    grace → 1.0s   │  ┌──────────────────────────────┐
   │ 5. read text      │  │ AccessibilityOnboarding      │
   │ 6. restore closure│  │ first-use trust flow + poll  │
   └─────────┬─────────┘  └──────────────────────────────┘
             ▼
   ┌────────────────────────────────────────────┐
   │ BackendFactory → ExtractionBackend         │
   │   AnthropicBackend │ OllamaBackend          │
   │ ContextCardValidation: validate → retry    │
   │ once → needsReview warning                 │
   │ KeychainHelper: API key CRUD + migration   │
   └────────────────────────────────────────────┘
```

Data flow for a capture (TRD §4):

```
select text → hotkey → exclusion check (frontmost app bundle ID)
→ snapshot clipboard → synthetic ⌘C → poll pasteboard changeCount
→ captured text → configured ExtractionBackend (validation + retry)
→ floating panel shows card → Copy → paste into destination
→ original clipboard restored after extraction completes
```

### One hotkey press, step by step

```
⌘⇧X pressed
   │
   ▼
GlobalHotKeyManager — global + local NSEvent monitors (needs Accessibility trust)
   │
   ▼
CaptureOrchestrator — ① frontmost app excluded? ── yes ─▶ silent no-op (no panel, no error)
   │ no
   ▼
FloatingPanelController — spinner panel in <100 ms, focus never stolen (TRD 6)
   │
   ▼   capture runs off the main thread
CaptureService
   ├─ ② snapshot the pasteboard (text + changeCount)
   ├─ ③ CGEvent posts a synthetic ⌘C to the frontmost app
   ├─ ④ poll changeCount — 20 ms × 500 ms, then 60 ms grace, 1.0 s total
   └─ ⑤ changed? read the text : report "nothing captured"
   │
   ▼
BackendFactory → ExtractionBackend (Local Ollama / Cloud Anthropic)
   └─ ⑥ extract → validate all 7 headers → one corrective retry if malformed
   │
   ▼
   ├─ ⑦ restore the original clipboard (if enabled)
   ├─ ⑧ panel shows card / needsReview / failure
   └─ ⑨ status-item icon flashes ~1 s (TRD 5)
```

### Orchestrator state machine

The `isDismissedDuringCapture` logic exists so a result never ambushes you after you've closed the panel:

```
            ⌘⇧X (no panel showing)              extraction finishes
  ┌──────┐ ───────────────────────▶ ┌───────────┐ ───────────────────▶ ┌───────────────┐
  │ IDLE │                          │ CAPTURING │                      │ RESULT SHOWN  │
  └──────┘ ◀─────────────────────── └─────┬─────┘                      │ card, warning │
      ▲                                   │                            │    or error   │
      │  ⌘⇧X pressed while the panel      │ Esc / click-away           └───────┬───────┘
      │  already shows a result:          │ while still extracting             │
      │  just dismiss it                  ▼                                    │ Esc · click-away ·
      │                    ┌──────────────────────────┐                        │ ⌘⇧X again · Copy
      │                    │ DISMISSED-DURING-CAPTURE │                        │
      │                    │ the pending result is    │                        │ all transitions
      │                    │ silently discarded when  │                        │ → IDLE
      │                    │ it arrives               │                        │
      │                    └────────────┬─────────────┘                        │
      │             result dropped,     │                                      │
      └─────────────────────────────────┴──────────────────────────────────────┘
```

### Panel states

```
                      ┌─ all 7 headers present ─────▶ SUCCESS — card + Copy
loading (spinner) ────┼─ malformed even after retry ▶ NEEDS REVIEW — orange warning + card + Copy
                      └─ backend error ────────────▶ FAILURE — specific error message
```

Key design decisions:

- **Exclusion check runs before anything else** — in a blocked app the hotkey is a no-op: no panel, no error, no risk of grabbing a password field.
- **Poll, don't sleep**: the pasteboard `changeCount` is polled at 20ms (500ms window) then a 60ms grace tail (1.0s total). Fast apps resolve in one or two polls; slow ones still land, and "nothing selected" fails fast instead of capturing stale text.
- **Capture work runs off the main thread** so a slow model never freezes hotkey responsiveness; the backend is rebuilt from settings on every call, so Settings changes apply immediately.
- **One validation layer for both backends**: cards missing required headers (common with small local models) get one corrective retry, then a visible `needsReview` state — never silently shown as clean.
- **Secrets in the Keychain** (`KeychainHelper`, `SecItemAdd/CopyMatching/Update`); only non-secrets live in `@AppStorage`.
- **`SMAppService` for launch-at-login** (macOS 13+ API); registration state is source of truth, re-synced when Settings opens.

### Project layout

```
Sources/ContextTransfer/
  ContextTransferApp.swift        // @main; AppDelegate owns status item, hotkey, paste-in window
  ContentView.swift               // Phase 1 paste-in UI + SettingsKeys + BackendType
  SettingsView.swift              // backend, hotkey + test, exclusions, panel, launch-at-login
  ExtractionBackend.swift         // protocol + system prompt + validation/retry + parsing
  AnthropicBackend.swift          // cloud implementation
  OllamaBackend.swift             // local implementation + /api/tags + num_ctx/OOM handling
  BackendFactory.swift            // settings → backend construction (both flows)
  KeychainHelper.swift            // Keychain storage for the Anthropic API key
  GlobalHotKeyManager.swift       // global + local keyDown monitors
  HotKeyCodec.swift               // persisted combo encode/decode/display
  HotKeyRecorderView.swift        // click-to-record shortcut control
  CaptureService.swift            // exclusions + snapshot → CGEvent ⌘C → two-phase poll → restore
  CaptureOrchestrator.swift       // end-to-end quick-capture state machine
  FloatingPanelController.swift   // non-activating NSPanel + dismiss monitors
  PanelContentView.swift          // panel UI: loading / success / needsReview / failure
  AccessibilityOnboarding.swift   // one-time trust check + polling
  StatusItemController.swift      // NSStatusItem menu + capture flash
  LaunchAtLogin.swift             // SMAppService launch-at-login toggle
Resources/
  Info.plist                      // LSUIElement menu bar agent
  ContextTransfer.entitlements    // sandbox OFF (Phase 2 requirement)
Scripts/build-app.sh              // build + bundle + sign the .app
```

## Troubleshooting

- **Shortcut does nothing** → Settings → **Test shortcut**. "Not detected" means another app owns the combo — record a different one. Also check System Settings → Privacy & Security → Accessibility lists ContextTransfer.
- **Granted Accessibility but still nothing** → quit and reopen the app once; macOS sometimes applies the grant on relaunch.
- **"Couldn't reach Ollama at …"** → run `ollama serve`, and `ollama pull <model>` for your model.
- **"Ollama ran out of memory…"** → try a smaller model or close other apps (distinct from the unreachable error on purpose — the fix differs).
- **Long-conversation warning** → the input may exceed the 8K-token context window; the card could be truncated. Split the conversation or use the cloud backend.
- **Clipboard-history manager (Paste, Raycast, …)** → every synthetic ⌘C appears in its history; there's no OS-level way to mark a copy internal-only.

## Phase 2 testing checklist (TRD §7)

- [ ] Hotkey fires from within at least 3 different apps (browser, Notes, a code editor) with text selected
- [ ] Original clipboard contents are restored correctly after capture
- [ ] Empty selection shows a clear error, not a blank/loading panel forever
- [ ] Panel doesn't steal focus from the app the user was working in
- [ ] Accessibility permission prompt only appears once, on first real use, with a clear explanation
- [ ] Works with both backends (Anthropic + Ollama) without code changes to the capture flow
