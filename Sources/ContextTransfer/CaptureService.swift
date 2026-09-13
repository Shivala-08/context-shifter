import AppKit
import Carbon.HIToolbox

/// Phase 2 capture pipeline:
///   save clipboard → synthesize ⌘C at the HID tap → poll the pasteboard for
///   the selection → return the text plus a closure that restores the original
///   clipboard after extraction completes (TRD 3.3).
final class CaptureService {
    /// Brief settle before the first check so the target app has processed
    /// the synthetic ⌘C. (The old flat 120ms wasted time on every fast app —
    /// pasteboard writes usually land in 20–80ms.)
    private let initialSettle: TimeInterval = 0.02 // 20ms

    // Phase 1 (TRD 3.3 step 4): poll every ~20ms for up to ~500ms — fast apps
    // resolve in 20–100ms total, ~10× quicker than the old fixed-delay flow.
    private let fastPollInterval: UInt64 = 20_000_000 // 20ms
    private let fastPollWindow: TimeInterval = 0.5

    // Phase 2 grace tail: some apps write the pasteboard late (huge docs,
    // sluggish Electron). A hard 500ms cutoff would miss them and silently
    // capture STALE clipboard content — the worst failure mode. Trickier
    // polling for another 0.5s covers them while "nothing selected" still
    // resolves in ~1s instead of the old 1.2s.
    private let slowPollInterval: UInt64 = 60_000_000 // 60ms
    private let slowPollWindow: TimeInterval = 1.0    // total capture deadline

    struct Outcome {
        /// Captured selection text; `nil` means nothing was selected
        /// (pasteboard unchanged/empty) — callers show an error state.
        let text: String?
        /// Call after extraction completes to give the user their clipboard back.
        let restoreClipboard: (() -> Void)?
    }

    /// Async facade: the blocking poll runs off the main thread so a capture
    /// never freezes the UI or hotkey responsiveness (TRD 6).
    func captureSelection() async -> Outcome {
        await withCheckedContinuation { continuation in
            DispatchQueue.global(qos: .userInitiated).async { [self] in
                continuation.resume(returning: performCapture())
            }
        }
    }

    private func performCapture() -> Outcome {
        // NSPasteboard is thread-safe (10.6+); this runs off the main thread.
        let pasteboard = NSPasteboard.general
        let saved = ClipboardSnapshot.of(pasteboard)

        // Synthetic Cmd+C to whatever app is frontmost.
        guard let down = CGEvent(keyboardEventSource: nil, virtualKey: CGKeyCode(kVK_ANSI_C), keyDown: true),
              let up = CGEvent(keyboardEventSource: nil, virtualKey: CGKeyCode(kVK_ANSI_C), keyDown: false)
        else {
            return Outcome(text: nil, restoreClipboard: nil)
        }
        down.flags = [.maskCommand]
        up.flags = [.maskCommand]
        down.post(tap: .cghidEventTap)
        up.post(tap: .cghidEventTap)

        // Poll for the fresh pasteboard change (the target app copies
        // asynchronously). Two-phase: spec cadence first, then a grace tail.
        Thread.sleep(forTimeInterval: initialSettle)
        let start = Date()
        var captured = pollPasteboard(
            pasteboard,
            changeCountBefore: saved.changeCount,
            interval: fastPollInterval,
            deadline: start.addingTimeInterval(fastPollWindow)
        )
        if captured == nil {
            captured = pollPasteboard(
                pasteboard,
                changeCountBefore: saved.changeCount,
                interval: slowPollInterval,
                deadline: start.addingTimeInterval(slowPollWindow)
            )
        }

        // Only hand back a restore closure when we actually took the
        // clipboard over; on failure the pasteboard was never touched.
        return Outcome(
            text: captured,
            restoreClipboard: captured != nil ? { saved.restore(to: pasteboard) } : nil
        )
    }

    /// Checks the pasteboard at `interval` until `deadline`, returning the
    /// captured text as soon as a fresh non-empty string appears (or nil).
    private func pollPasteboard(
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
