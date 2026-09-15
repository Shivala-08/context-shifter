import AppKit
import ApplicationServices

/// One-click pipeline self-check for Settings' "Run diagnostics" button.
/// Runs synchronously (~well under a second; the only network probe has a
/// short timeout) and returns a human-readable report covering every stage
/// of the capture chain, in order:
///   Accessibility trust → hotkey monitors live → combo ownership →
///   frontmost-app eligibility → clipboard round-trip → Ollama backend.
enum PipelineDiagnostics {
    struct Check: Identifiable {
        let id = UUID()
        let name: String
        let passed: Bool
        /// "warn" = not fatal, "fail" = capture is dead at this stage.
        let severity: Severity
        let detail: String

        enum Severity { case ok, warn, fail }

        var symbol: String {
            switch severity {
            case .ok: return passed ? "checkmark.circle.fill" : "xmark.circle.fill"
            case .warn: return "exclamationmark.triangle.fill"
            case .fail: return "xmark.octagon.fill"
            }
        }
    }

    struct Report {
        let checks: [Check]
        var summary: String {
            let failures = checks.filter { !$0.passed && $0.severity == .fail }
            if failures.isEmpty {
                return "All stages passed — the capture pipeline is healthy."
            }
            return "\(failures.count) blocking stage\(failures.count == 1 ? "" : "s"): capture is stopped at " +
                failures.map(\.name).joined(separator: " → ") + "."
        }
    }

    static func run(appDelegate: AppDelegate?) -> Report {
        var checks: [Check] = []

        // 1. Accessibility trust — the gate everything else depends on.
        let trusted = AccessibilityOnboarding.isTrusted()
        // AppDelegate is @MainActor; PipelineDiagnostics is only ever invoked
        // from the Settings UI (main thread), so this hop is safe and instant.
        let monitorsActive = MainActor.assumeIsolated { appDelegate?.hotKeyMonitorsActive ?? false }
        checks.append(Check(
            name: "Accessibility",
            passed: trusted,
            severity: .fail,
            detail: trusted
                ? "Granted for this build."
                : "Not granted for THIS binary — nothing downstream can work. Re-add the app in System Settings → Privacy & Security → Accessibility."
        ))

        // 2. Global hotkey monitors installed (only possible when trusted).
        checks.append(Check(
            name: "Shortcut listener",
            passed: monitorsActive,
            severity: trusted ? .fail : .warn,
            detail: monitorsActive
                ? "Global monitors are installed and listening."
                : trusted
                    ? "Trusted but monitors not installed — press Test shortcut once (installs them), or relaunch."
                    : "Monitors can't install until Accessibility is granted."
        ))

        // 3. Combo ownership (system probe; meaningful only when trusted).
        let combo = HotKeyCodec.decode(UserDefaults.standard.string(forKey: SettingsKeys.hotKey) ?? "") ?? .default
        if trusted {
            switch HotKeyProbe.check(combo) {
            case .free:
                checks.append(Check(
                    name: "Combo ownership",
                    passed: true,
                    severity: .ok,
                    detail: "\(HotKeyCodec.displayString(combo)) is free — no other app holds it."
                ))
            case .takenByOtherApp:
                checks.append(Check(
                    name: "Combo ownership",
                    passed: false,
                    severity: .fail,
                    detail: "\(HotKeyCodec.displayString(combo)) is owned by another app. Pick a different one in Settings."
                ))
            case .failed(let status):
                checks.append(Check(
                    name: "Combo ownership",
                    passed: false,
                    severity: .warn,
                    detail: "Probe failed (system error \(status)) — inconclusive, not blocking."
                ))
            }
        } else {
            checks.append(Check(
                name: "Combo ownership",
                passed: false,
                severity: .warn,
                detail: "Skipped — needs Accessibility first."
            ))
        }

        // 4. Frontmost app eligibility (exclusions, bundle ID readable).
        let frontmost = NSWorkspace.shared.frontmostApplication
        let frontmostBundle = frontmost?.bundleIdentifier
        let excluded = frontmostBundle.map { CaptureExclusions.isExcluded($0) } ?? false
        checks.append(Check(
            name: "Target app eligibility",
            passed: !(frontmost == nil || excluded),
            severity: .warn,
            detail: frontmost == nil
                ? "No frontmost app detected right now — capture will target the last external app."
                : excluded
                    ? "\(frontmost?.localizedName ?? frontmostBundle ?? "?") is on the exclusion list — capture is skipped there by design."
                    : "Frontmost app \(frontmost?.localizedName ?? "?") is eligible."
        ))

        // 5. Clipboard round-trip (capture copies the selection via ⌘C).
        let pasteboard = NSPasteboard.general
        let changeCount = pasteboard.changeCount
        pasteboard.setString("ct-diag-\(Int(Date().timeIntervalSince1970))", forType: .string)
        let roundTrip = pasteboard.string(forType: .string)?.hasPrefix("ct-diag-") ?? false
        checks.append(Check(
            name: "Clipboard access",
            passed: roundTrip,
            severity: .fail,
            detail: roundTrip
                ? "Read/write works (change count \(changeCount))."
                : "Cannot write/read the pasteboard — capture would fail at the copy step."
        ))

        // 6. Ollama backend reachability (only when Local is selected).
        let backendRaw = UserDefaults.standard.string(forKey: SettingsKeys.backendType) ?? ""
        let backend = BackendType(rawValue: backendRaw) ?? .local
        if backend == .local {
            let host = UserDefaults.standard.string(forKey: SettingsKeys.ollamaHost) ?? OllamaBackend.defaultHost
            let semaphore = DispatchSemaphore(value: 0)
            var ollamaUp = false
            var ollamaDetail = ""
            var request = URLRequest(url: URL(string: OllamaBackend.normalizedHost(host).appending("/api/tags"))!)
            request.timeoutInterval = 2.5
            URLSession.shared.dataTask(with: request) { _, response, error in
                if let error {
                    ollamaDetail = error.localizedDescription
                } else if let http = response as? HTTPURLResponse, http.statusCode == 200 {
                    ollamaUp = true
                } else {
                    ollamaDetail = "Unexpected response: \(String(describing: response))"
                }
                semaphore.signal()
            }.resume()
            _ = semaphore.wait(timeout: .now() + 3)
            checks.append(Check(
                name: "Ollama backend",
                passed: ollamaUp,
                severity: .fail,
                detail: ollamaUp
                    ? "Reachable at \(host)."
                    : "Not reachable at \(host) — \(ollamaDetail.isEmpty ? "connection failed" : ollamaDetail). Start Ollama or switch backends."
            ))
        } else {
            checks.append(Check(
                name: "Anthropic backend",
                passed: !(KeychainHelper.load() ?? "").isEmpty,
                severity: .warn,
                detail: (KeychainHelper.load() ?? "").isEmpty
                    ? "No API key saved yet — extraction will fail until one is set in Settings."
                    : "API key present in Keychain."
            ))
        }

        return Report(checks: checks)
    }
}
