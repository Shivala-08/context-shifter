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
- **Handle collisions.** `NSEvent`'s global monitor doesn't "fail" loudly if another app already owns that combo system-wide — it can just never fire, which looks like a silent bug to the user. Mitigate by: defaulting to an unusual combo unlikely to collide (`Cmd+Shift+X` is a reasonable start but verify against common app defaults), and adding a "Test hotkey" button in Settings that the user presses immediately after setting one — if the app doesn't detect its own registered event within a couple seconds, show "This combo may already be in use by another app — try a different one."

### 3.3 CaptureService
- On hotkey trigger:
  1. **Check the frontmost app against an exclusion list first**, before doing anything else. Maintain a small blocklist of bundle identifiers where capture should never fire — password managers (1Password: `com.1password.1password`, Keychain Access), banking apps, and anything the user adds in Settings. If the frontmost app matches, silently do nothing (no panel, no error) rather than capturing what could be a password field.
  2. Save current clipboard contents (to restore after, so we don't clobber the user's clipboard) — capture both the string value and `NSPasteboard.general.changeCount`.
  3. Synthesize Cmd+C via `CGEvent(keyboardEventSource:virtualKey:keyDown:)` posted to `.cghidEventTap`, targeting whatever app is currently frontmost.
  4. **Poll for the copy to actually land instead of using a fixed delay.** A flat 100–150ms sleep is a guess that can miss slow apps (silently capturing stale clipboard content with no way to detect it) or waste time on fast ones. Instead, poll `NSPasteboard.general.changeCount` every ~20ms for up to ~500ms; proceed as soon as it increments past the value saved in step 2, or treat it as "nothing was selected" if it never changes within the timeout.
  5. Read the new clipboard text.
  6. Restore the original clipboard contents after extraction completes.
  7. If nothing was selected (changeCount never incremented), show a clear "Nothing selected" state in the panel instead of calling the backend with empty/stale input.
- **Known limitation, not fully fixable**: if the user runs a clipboard-history manager (Paste, Raycast clipboard, etc.), every synthetic copy will still appear in that tool's history alongside intentional copies, since there's no OS-level way to mark a copy as "internal only." Worth a one-line mention in Settings/README rather than something to silently work around.

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
- Code signing: Developer ID signing + notarization required for distribution outside the App Store. **Concretely, before the first fresh install on any machine**: `codesign --deep --force --sign "Developer ID Application: <name>" ContextTransfer.app`, then `xcrun notarytool submit` + `xcrun stapler staple`. Skipping this produces the classic "app is damaged and can't be opened" Gatekeeper error — easy to mistake for a real build problem if you don't know that's what's happening. Not needed if it only ever runs on the same Mac it was built on via Xcode, but do it before sharing the build or reinstalling from scratch.
- **Menu bar visibility**: since `LSUIElement` hides the Dock icon, there's no normal way to tell if the app is running besides the (easy to overlook) menu bar glyph. Give the status item two visual states — idle icon vs. a briefly-highlighted/filled icon for ~1s right after a successful capture — so there's positive confirmation the hotkey actually did something, not just silence.

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
