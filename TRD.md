# TRD — Context Transfer

## 1. Platform & distribution
- macOS 13+, SwiftUI + AppKit (AppKit needed for menu bar item, floating panel, and global event monitoring — SwiftUI alone can't do these).
- **Phase 1** can ship as a sandboxed app (Mac App Store compatible).
- **Phase 2 requires disabling App Sandbox.** Simulating a keystroke (synthetic Cmd+C) via `CGEvent` and installing a global hotkey monitor both require capabilities the sandbox blocks. Distribute as a signed + notarized app outside the App Store (same model as Raycast, Alfred, Bartender).

## 2. Phase 1 architecture (already specced — see BUILD_MANUAL.md)
- `ExtractionBackend` protocol with `AnthropicBackend` and `OllamaBackend` implementations.
- `ContentView` (paste box UI), `SettingsView` (backend config), `@AppStorage` for persisted settings.
- No changes needed to this layer for Phase 2 — it's reused as-is by the new capture flow.

## 3. Phase 2 components (new)

### 3.1 MenuBarController
- `NSStatusItem` in the menu bar (icon only, no dock icon — set `LSUIElement = true` in Info.plist so it's a background/agent app).
- Menu items: "Settings…", "Quit". No main window shown on launch.

### 3.2 GlobalHotKeyManager
- Register a global hotkey (e.g. default `Cmd+Shift+X`, user-configurable in Settings) using `NSEvent.addGlobalMonitorForEvents(matching: .keyDown)`.
- This requires the app to be **Accessibility-trusted**: check `AXIsProcessTrusted()` on launch; if false, show a one-time onboarding screen explaining why, with a button that opens System Settings → Privacy & Security → Accessibility (via `AXIsProcessTrustedWithOptions` prompt or a direct `x-apple.systempreferences:` URL).

### 3.3 CaptureService
- On hotkey trigger:
  1. Save current clipboard contents (to restore after, so we don't clobber the user's clipboard).
  2. Synthesize Cmd+C via `CGEvent(keyboardEventSource:virtualKey:keyDown:)` posted to `.cghidEventTap`, targeting whatever app is currently frontmost — this copies the user's current selection without them pressing Cmd+C themselves.
  3. Poll/read `NSPasteboard.general` shortly after (small delay, e.g. 100–150ms, to let the target app finish the copy) to get the captured text.
  4. Restore the original clipboard contents after extraction completes (so the user's own copy history isn't disrupted).
  5. If nothing was selected (clipboard unchanged / empty), show an error state in the panel instead of calling the backend with empty input.

### 3.4 FloatingPanelWindow
- An `NSPanel` with `.floating` window level, `.nonactivatingPanel` style (so it doesn't steal focus from whatever app the user was in), positioned near the current mouse location (`NSEvent.mouseLocation`) or a fixed screen corner (user preference).
- Contents: a SwiftUI view (hosted via `NSHostingView`) showing a loading state, then the extracted card with a Copy button, matching the Phase 1 output styling.
- Dismiss on: click outside the panel, `Esc` key, or pressing the capture hotkey again.

### 3.5 Settings additions
- Hotkey picker (record a key combo) — persist via `@AppStorage` as a string encoding of key + modifiers.
- Toggle: "Restore clipboard after capture" (default on).
- Toggle/position picker: panel appears "near cursor" vs "fixed corner."
- Existing backend settings (Anthropic key / Ollama host+model) carry over unchanged from Phase 1.

## 4. Data flow (Phase 2)
```
User selects text in any app
   → presses global hotkey
   → GlobalHotKeyManager fires
   → CaptureService: save clipboard → synthesize Cmd+C → read clipboard → restore clipboard
   → captured text passed to currently-configured ExtractionBackend (same protocol as Phase 1)
   → result shown in FloatingPanelWindow
   → user clicks Copy → NSPasteboard.general set to the card
   → user pastes into destination app
```

## 5. Permissions & entitlements checklist
- App Sandbox: **disabled** (Phase 2).
- Info.plist: `LSUIElement = true` (menu bar only, no Dock icon).
- Accessibility: requested at first hotkey-use, not at launch (don't prompt before the user has tried the feature).
- Code signing: Developer ID signing + notarization required for distribution outside the App Store (Gatekeeper will otherwise block launch on other Macs — less relevant if it only ever runs on your own machine, but do it anyway if there's any chance of installing it fresh later).

## 6. Non-functional requirements
- Global hotkey handling must not block the main thread — keep `CaptureService` work async so a slow model response doesn't freeze hotkey responsiveness for next time.
- Panel show/dismiss should feel instant (<100ms) even if extraction is still loading — show the panel with a spinner immediately, populate when the backend call resolves.
- Local (Ollama) backend should be the default suggested for Phase 2's "quick capture" use case, since it's meant to be fast/frictionless — cloud remains available for cases where quality matters more than speed.

## 7. Testing checklist (Phase 2)
- [ ] Hotkey fires from within at least 3 different apps (browser, Notes, a code editor) with text selected
- [ ] Original clipboard contents are restored correctly after capture
- [ ] Empty selection shows a clear error, not a blank/loading panel forever
- [ ] Panel doesn't steal focus from the app the user was working in
- [ ] Accessibility permission prompt only appears once, on first real use, with a clear explanation
- [ ] Works with both backends (Anthropic + Ollama) without code changes to the capture flow
