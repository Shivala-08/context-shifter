import AppKit
import ApplicationServices
import Carbon.HIToolbox
import os

/// Unified-log identity for the capture pipeline, shared by the service and
/// the orchestrator: subsystem `com.contexttransfer.app`, categories `capture`
/// and `orchestrator`. View with:
///   log stream --predicate 'subsystem == "com.contexttransfer.app"'
/// (pass --info / --debug — the pipeline logs at info level). At least one
/// entry fires on EVERY hotkey press, including early exits, so a dead
/// shortcut is never indistinguishable from an unused one.
enum CaptureLogger {
    static let capture = Logger(subsystem: "com.contexttransfer.app", category: "capture")
    static let orchestrator = Logger(subsystem: "com.contexttransfer.app", category: "orchestrator")
}

/// Ordered, human-readable record of one capture attempt: which strategy ran,
/// what each step saw, and why the attempt ended. Mirrored to the unified log
/// (Console.app → subsystem `com.contexttransfer.app`, category `capture`)
/// and attached to the Outcome so the failure panel can show the trail.
struct CaptureLog: CustomStringConvertible {
    private(set) var entries: [String] = []

    mutating func add(_ message: String) {
        entries.append(message)
        CaptureLogger.capture.info("\(message, privacy: .public)")
    }

    var description: String { entries.joined(separator: "\n") }
}

/// Capture pipeline, in strategy order:
///   1. AX-first: read the focused element's selected text via the
///      Accessibility API — when the app exposes it (most native text views
///      do) there's no keystroke, no clipboard takeover, no poll wait.
///   2. Synthetic ⌘C fallback: save clipboard → post ⌘C at the HID tap →
///      poll the pasteboard → restore the original clipboard after extraction
///      completes (TRD 3.3).
///   2b. Electron retry: Electron apps copy via renderer→main IPC that can
///      trail the keystroke; one delayed second ⌘C recovers them.
final class CaptureService {
    /// Brief settle before the first check so the target app has processed
    /// the synthetic ⌘C. (The old flat 120ms wasted time on every fast app —
    /// pasteboard writes usually land in 20–80ms.)
    private static let initialSettle: TimeInterval = 0.02 // 20ms

    // Phase 1 (TRD 3.3 step 4): poll every ~20ms for up to ~500ms — fast apps
    // resolve in 20–100ms total, ~10× quicker than the old fixed-delay flow.
    private static let fastPollInterval: UInt64 = 20_000_000 // 20ms
    private static let fastPollWindow: TimeInterval = 0.5

    // Phase 2 grace tail: some apps write the pasteboard late (huge docs,
    // sluggish Electron). A hard 500ms cutoff would miss them and silently
    // capture STALE clipboard content — the worst failure mode. Trickier
    // polling for another 0.5s covers them while "nothing selected" still
    // resolves in ~1s instead of the old 1.2s.
    private static let slowPollInterval: UInt64 = 60_000_000 // 60ms
    private static let slowPollWindow: TimeInterval = 1.0    // total capture deadline

    /// Delay before the Electron-specific second ⌘C (gives the renderer→main
    /// copy IPC time to settle).
    private static let electronRetryDelay: TimeInterval = 0.25

    struct Outcome {
        /// Captured selection text; `nil` means nothing was selected
        /// (pasteboard unchanged/empty) — callers show an error state.
        let text: String?
        /// Call after extraction completes to give the user their clipboard back.
        let restoreClipboard: (() -> Void)?
        /// Step-by-step record of what was tried and why it ended this way.
        let diagnostics: String
    }

    /// Async facade: the blocking work runs off the main thread so a capture
    /// never freezes the UI or hotkey responsiveness (TRD 6).
    /// `targetApp` is the app whose selection we want (nil = current frontmost).
    func captureSelection(in targetApp: NSRunningApplication?) async -> Outcome {
        await withCheckedContinuation { continuation in
            DispatchQueue.global(qos: .userInitiated).async {
                continuation.resume(returning: CaptureService.performCapture(targetApp: targetApp))
            }
        }
    }

    private static func performCapture(targetApp: NSRunningApplication?) -> Outcome {
        var log = CaptureLog()

        guard let app = targetApp ?? NSWorkspace.shared.frontmostApplication else {
            log.add("no target app (nothing frontmost) — giving up")
            return Outcome(text: nil, restoreClipboard: nil, diagnostics: log.description)
        }
        let electron = isElectronApp(app)
        log.add("target: \(app.localizedName ?? "?") (\(app.bundleIdentifier ?? "?"), pid \(app.processIdentifier))\(electron ? " [electron]" : "")")

        // Strategy 1 — read the selection straight out of the app's
        // accessibility tree. Works in Notes, TextEdit, Xcode, Safari and most
        // native text views; skips keystroke, clipboard churn and poll waits.
        if let text = Self.axSelectedText(pid: app.processIdentifier, log: &log) {
            log.add("done: AX strategy, \(text.count) chars — no keystroke sent, clipboard untouched")
            return Outcome(text: text, restoreClipboard: nil, diagnostics: log.description)
        }

        // Strategy 2 — synthetic ⌘C. The selection's app must be frontmost
        // when the keystroke lands: a capture started from our own status-bar
        // menu left THIS app frontmost, so bring the target back first.
        if app.processIdentifier != ProcessInfo.processInfo.processIdentifier,
           NSWorkspace.shared.frontmostApplication?.processIdentifier != app.processIdentifier {
            log.add("refocusing target app (our app was frontmost — status-bar menu path)")
            Self.bringToFront(app)
        }

        // The user is still physically holding the hotkey modifiers (e.g.
        // ⌘⇧X): hardware modifier state merges with the synthetic event, so a
        // ⌘C posted now can arrive at the target as ⌘⇧C — a different
        // shortcut that copies nothing. Wait (briefly) for the keys to come up.
        if Self.waitPhysicalModifiersReleased() {
            log.add("hotkey modifiers released, posting ⌘C")
        } else {
            log.add("modifiers STILL held after 0.3s — posting ⌘C anyway (risk of ⌘⇧C merge)")
        }

        // NSPasteboard is thread-safe (10.6+); this runs off the main thread.
        let pasteboard = NSPasteboard.general
        let saved = ClipboardSnapshot.of(pasteboard)

        guard Self.postCopyKeystroke(log: &log) else {
            log.add("could not create CGEvent — giving up")
            return Outcome(text: nil, restoreClipboard: nil, diagnostics: log.description)
        }

        // Poll for the fresh pasteboard change (the target app copies
        // asynchronously). Two-phase: spec cadence first, then a grace tail.
        Thread.sleep(forTimeInterval: Self.initialSettle)
        let start = Date()
        var captured = Self.pollPasteboard(
            pasteboard,
            changeCountBefore: saved.changeCount,
            interval: Self.fastPollInterval,
            deadline: start.addingTimeInterval(Self.fastPollWindow)
        )
        if captured == nil {
            captured = Self.pollPasteboard(
                pasteboard,
                changeCountBefore: saved.changeCount,
                interval: Self.slowPollInterval,
                deadline: start.addingTimeInterval(Self.slowPollWindow)
            )
        }

        // Strategy 1b — AX retry. Some apps (notably Electron) populate the
        // AX selection only after a copy keystroke, or expose it late. One
        // more read rescues the capture without a second keystroke.
        if captured == nil {
            log.add("⌘C produced no pasteboard change — retrying the AX read once (some apps populate the AX selection late)")
            if let text = Self.axSelectedText(pid: app.processIdentifier, log: &log, deadEndSuffix: "→ giving up") {
                // We already posted a keystroke, so the clipboard may have
                // changed even though our poll never saw a usable write —
                // restore it to be safe.
                log.add("done: AX retry after ⌘C, \(text.count) chars (clipboard restored)")
                return Outcome(
                    text: text,
                    restoreClipboard: { saved.restore(to: pasteboard) },
                    diagnostics: log.description
                )
            }
        }

        // Strategy 2b — Electron retry. Electron renders in a separate
        // process; its copy goes renderer→main over IPC and can trail the
        // keystroke (or drop it while the menu system revalidates). One
        // delayed second ⌘C recovers those without slowing anyone else down.
        if captured == nil && electron {
            log.add("no pasteboard change after 1.0s — electron retry: second ⌘C in 250ms")
            Thread.sleep(forTimeInterval: Self.electronRetryDelay)
            _ = Self.postCopyKeystroke(log: &log)
            let retryStart = Date()
            captured = Self.pollPasteboard(
                pasteboard,
                changeCountBefore: saved.changeCount,
                interval: Self.fastPollInterval,
                deadline: retryStart.addingTimeInterval(Self.fastPollWindow)
            )
            if captured == nil {
                captured = Self.pollPasteboard(
                    pasteboard,
                    changeCountBefore: saved.changeCount,
                    interval: Self.slowPollInterval,
                    deadline: retryStart.addingTimeInterval(Self.slowPollWindow)
                )
            }
        }

        if let captured {
            log.add("done: ⌘C strategy, \(captured.count) chars (clipboard restored after extraction)")
            return Outcome(
                text: captured,
                restoreClipboard: { saved.restore(to: pasteboard) },
                diagnostics: log.description
            )
        }

        log.add(saved.text != nil
            ? "gave up: app never wrote the clipboard (it was holding stale text — is anything selected?)"
            : "gave up: app never wrote the clipboard (it was empty)")
        return Outcome(text: nil, restoreClipboard: nil, diagnostics: log.description)
    }

    /// Reads `kAXSelectedText` from the app's focused element; falls back to
    /// slicing the full value by `kAXSelectedTextRange` for apps that expose
    /// the range but not the string. Nil when the app exposes nothing usable.
    /// Every dead end is logged with its AXError so failures are explainable.
    /// `deadEndSuffix` finishes each dead-end line (differs by call site).
    private static func axSelectedText(pid: pid_t, log: inout CaptureLog, deadEndSuffix: String = "→ will try ⌘C") -> String? {
        let app = AXUIElementCreateApplication(pid)
        // Bound any misbehaving app's AX reply so a capture can never hang
        // on a wedged process.
        AXUIElementSetMessagingTimeout(app, 1.0)

        var focusedBox: CFTypeRef?
        let focusError = AXUIElementCopyAttributeValue(app, kAXFocusedUIElementAttribute as CFString, &focusedBox)
        guard focusError == .success, let focused = focusedBox else {
            log.add("AX: no focused element (AXError \(focusError.rawValue)) \(deadEndSuffix)")
            return nil
        }
        let element = focused as! AXUIElement
        AXUIElementSetMessagingTimeout(element, 1.0)

        var textBox: CFTypeRef?
        if AXUIElementCopyAttributeValue(element, kAXSelectedTextAttribute as CFString, &textBox) == .success,
           let text = textBox as? String {
            let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmed.isEmpty { return trimmed }
        }

        // Range + full-value fallback for apps that expose the selection
        // range but not the selected string itself.
        var rangeBox: CFTypeRef?
        var fullBox: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, kAXSelectedTextRangeAttribute as CFString, &rangeBox) == .success,
              let rangeValue = rangeBox, CFGetTypeID(rangeValue) == AXValueGetTypeID(),
              AXUIElementCopyAttributeValue(element, kAXValueAttribute as CFString, &fullBox) == .success,
              let fullText = fullBox as? String
        else {
            log.add("AX: focused element exposes no selected text \(deadEndSuffix)")
            return nil
        }

        var range = CFRange()
        guard AXValueGetValue(rangeValue as! AXValue, .cfRange, &range),
              range.location >= 0, range.length > 0,
              range.location + range.length <= fullText.count
        else {
            log.add("AX: selection range unusable \(deadEndSuffix)")
            return nil
        }

        let start = fullText.index(fullText.startIndex, offsetBy: range.location)
        let end = fullText.index(start, offsetBy: range.length)
        let selection = String(fullText[start..<end]).trimmingCharacters(in: .whitespacesAndNewlines)
        if selection.isEmpty {
            log.add("AX: selected text empty \(deadEndSuffix)")
            return nil
        }
        return selection
    }

    /// True when the app is built on Electron (Slack, Discord, VS Code,
    /// Notion…) — triggers the delayed second-⌘C retry.
    private static func isElectronApp(_ app: NSRunningApplication) -> Bool {
        guard let bundleURL = app.bundleURL else { return false }
        return FileManager.default.fileExists(
            atPath: bundleURL.appendingPathComponent("Contents/Frameworks/Electron Framework.framework").path
        )
    }

    /// Posts one synthetic Cmd+C at the HID tap.
    @discardableResult
    private static func postCopyKeystroke(log: inout CaptureLog) -> Bool {
        guard let down = CGEvent(keyboardEventSource: nil, virtualKey: CGKeyCode(kVK_ANSI_C), keyDown: true),
              let up = CGEvent(keyboardEventSource: nil, virtualKey: CGKeyCode(kVK_ANSI_C), keyDown: false)
        else { return false }
        down.flags = [.maskCommand]
        up.flags = [.maskCommand]
        down.post(tap: .cghidEventTap)
        up.post(tap: .cghidEventTap)
        log.add("synthetic ⌘C posted")
        return true
    }

    /// Brings the selection's app back to the front (status-bar-menu path)
    /// and waits — briefly — for the activation to land.
    private static func bringToFront(_ app: NSRunningApplication) {
        if #available(macOS 14.0, *) {
            app.activate()
        } else {
            app.activate(options: [])
        }
        let deadline = Date().addingTimeInterval(0.4)
        while Date() < deadline,
              NSWorkspace.shared.frontmostApplication?.processIdentifier != app.processIdentifier {
            Thread.sleep(forTimeInterval: 0.02)
        }
    }

    /// Blocks until no hardware modifier key is physically down (bounded).
    /// Fixes the ⌘C-arrives-as-⌘⇧C merge when the hotkey itself uses modifiers.
    /// Returns false if the timeout expired with keys still held.
    @discardableResult
    private static func waitPhysicalModifiersReleased(timeout: TimeInterval = 0.3) -> Bool {
        let modifierKeys: [CGKeyCode] = [
            CGKeyCode(kVK_Command), CGKeyCode(kVK_RightCommand),
            CGKeyCode(kVK_Shift), CGKeyCode(kVK_RightShift),
            CGKeyCode(kVK_Option), CGKeyCode(kVK_RightOption),
            CGKeyCode(kVK_Control), CGKeyCode(kVK_RightControl),
            CGKeyCode(kVK_Function),
        ]
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if modifierKeys.allSatisfy({ !CGEventSource.keyState(.combinedSessionState, key: $0) }) {
                return true
            }
            Thread.sleep(forTimeInterval: 0.01)
        }
        return false
    }

    /// Checks the pasteboard at `interval` until `deadline`, returning the
    /// captured text as soon as a fresh non-empty string appears (or nil).
    private static func pollPasteboard(
        _ pasteboard: NSPasteboard,
        changeCountBefore: Int,
        interval: UInt64,
        deadline: Date
    ) -> String? {
        while Date() < deadline {
            if let text = Self.selectedText(from: pasteboard, changeCountBefore: changeCountBefore) {
                return text
            }
            Thread.sleep(forTimeInterval: Double(interval) / 1_000_000_000)
        }
        return nil
    }

    /// A pasteboard "change" counts as a capture only if the count moved AND
    /// the new content is non-empty text — protects against apps that beep on
    /// Cmd+C with nothing selected.
    private static func selectedText(from pasteboard: NSPasteboard, changeCountBefore: Int) -> String? {
        guard pasteboard.changeCount > changeCountBefore else { return nil }
        guard let types = pasteboard.types, types.contains(.string) else { return nil }
        guard let text = pasteboard.string(forType: .string)?
            .trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty
        else { return nil }
        return text
    }
}

/// Remembers the most recent frontmost app that isn't ours. Needed because a
/// capture started from the status-bar menu runs with OUR app frontmost (the
/// menu activated us) — the user's selection lives in whatever was frontmost
/// just before.
final class ExternalFrontmostTracker {
    private(set) var lastExternal: NSRunningApplication?
    private var observer: NSObjectProtocol?

    init() {
        lastExternal = NSWorkspace.shared.frontmostApplication
        observer = NSWorkspace.shared.notificationCenter.addObserver(
            forName: NSWorkspace.didActivateApplicationNotification,
            object: nil,
            queue: .main
        ) { [weak self] note in
            guard let app = note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication,
                  app.bundleIdentifier != Bundle.main.bundleIdentifier
            else { return }
            self?.lastExternal = app
        }
    }

    deinit {
        if let observer {
            NSWorkspace.shared.notificationCenter.removeObserver(observer)
        }
    }
}

/// TRD 3.3: apps quick capture must never fire in. Checked before anything
/// else happens on a hotkey press — if the frontmost app matches, do nothing
/// silently (no panel, no error): the selection could be a password field.
enum CaptureExclusions {
    /// Built-ins: password managers / secret stores.
    static let builtinBundleIDs: Set<String> = [
        "com.1password.1password",
        "com.apple.keychainaccess",
    ]

    static func isExcluded(_ bundleID: String) -> Bool {
        builtinBundleIDs.contains(bundleID) || userExclusions().contains(bundleID)
    }

    /// User-added IDs, stored one per line in UserDefaults (Settings editor).
    static func userExclusions(defaults: UserDefaults = .standard) -> [String] {
        let raw = defaults.string(forKey: SettingsKeys.captureExclusions) ?? ""
        return raw
            .split(separator: "\n")
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
    }
}

/// Immutable copy of the pasteboard's string content + change count.
struct ClipboardSnapshot {
    let changeCount: Int
    let text: String?

    static func of(_ pasteboard: NSPasteboard) -> ClipboardSnapshot {
        ClipboardSnapshot(
            changeCount: pasteboard.changeCount,
            text: pasteboard.string(forType: .string)
        )
    }

    func restore(to pasteboard: NSPasteboard) {
        pasteboard.clearContents()
        if let text {
            pasteboard.setString(text, forType: .string)
        }
    }
}
