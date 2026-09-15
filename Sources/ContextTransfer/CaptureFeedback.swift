import AppKit

/// Capture feedback players, driven by Settings toggles. Kept out of the
/// orchestrator so the sounds stay a one-line concern at each outcome site.
enum CaptureFeedback {
    /// Subtle confirmation when a capture+extraction succeeded. Default OFF —
    /// the status-item flash already confirms success, and a sound on every
    /// capture gets old fast.
    static func playSuccessIfEnabled(defaults: UserDefaults = .standard) {
        let enabled = defaults.object(forKey: SettingsKeys.soundOnCaptureSuccess) as? Bool ?? false
        guard enabled else { return }
        NSSound(named: "Tink")?.play()
    }

/// Attention when a capture or extraction failed. Default ON — a silent
/// failure just looks like the shortcut did nothing.
    static func playFailureIfEnabled(defaults: UserDefaults = .standard) {
        let enabled = defaults.object(forKey: SettingsKeys.soundOnCaptureFailure) as? Bool ?? true
        guard enabled else { return }
        NSSound(named: "Basso")?.play()
    }
}
