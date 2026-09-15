import AppKit

/// Owns the Phase 2 end-to-end flow: hotkey pressed → capture the selection
/// (saving clipboard) → extraction runs on the same configured backend as
/// Phase 1 → result (or error) appears in the floating panel → clipboard
/// restored after extraction completes.
@MainActor
final class CaptureOrchestrator: ObservableObject {
    private let captureService = CaptureService()
    private let panelController = FloatingPanelController()
    /// Remembers the last non-our-app frontmost app, so a capture started
    /// from our own status-bar menu still knows where the selection lives.
    private let frontmostTracker = ExternalFrontmostTracker()

    /// A capture/extraction cycle is in flight (panel may or may not be showing).
    private var isCapturing = false
    /// The user dismissed the panel while extraction was still running; the
    /// pending result must NOT pop the panel back open when it arrives.
    private var isDismissedDuringCapture = false

    /// Called when a capture is attempted without Accessibility trust.
    var onNeedsAccessibility: (() -> Void)?
    /// Called on a successful capture+card, for status-item feedback (TRD 5).
    var onCaptureSucceeded: (() -> Void)?

    init() {
        // Panel closed by any means (Esc, click-away, hotkey re-press, auto).
        panelController.onDismiss = { [weak self] in self?.handlePanelDismiss() }
    }

    /// Hotkey pressed (or "Quick Capture" clicked).
    func triggerCapture() {
        if panelController.isVisible {
            // Second press of the shortcut dismisses the panel (TRD 3.4).
            panelController.dismiss()
            return
        }

        if isCapturing {
            // Extraction still running but no panel (user closed it) — treat
            // this press as "cancel the pending result", not a new capture.
            isDismissedDuringCapture = true
            return
        }

        isCapturing = true
        isDismissedDuringCapture = false

        // TRD 3.3 — FIRST thing after state bookkeeping: if the app holding
        // the selection is excluded (password manager, banking, user list),
        // silently do nothing. No panel, no error: capturing there could grab
        // a password field, and popping UI about it would be worse than
        // silence. Normally that's the frontmost app — but a capture started
        // from our status-bar menu runs with OUR app frontmost, in which case
        // the selection lives in the last external frontmost app.
        var target = NSWorkspace.shared.frontmostApplication
        if target?.bundleIdentifier == Bundle.main.bundleIdentifier {
            target = frontmostTracker.lastExternal
        }
        guard let targetApp = target,
              let targetBundleID = targetApp.bundleIdentifier,
              !CaptureExclusions.isExcluded(targetBundleID)
        else {
            // Deliberate silence toward the user (TRD 3.3 — no UI in excluded
            // apps), but the unified log must still explain the dead hotkey.
            CaptureLogger.orchestrator.info("hotkey ignored: no eligible target (frontmost=\(target?.bundleIdentifier ?? "nil", privacy: .public), excluded or unknown)")
            isCapturing = false
            return
        }

        guard AccessibilityOnboarding.isTrusted() else {
            if TrustMonitor.grantBelongsToDifferentBuild {
                CaptureLogger.orchestrator.info("hotkey pressed but Accessibility not granted — \(TrustMonitor.rebuiltBinaryTrailNote, privacy: .public)")
            } else {
                CaptureLogger.orchestrator.info("hotkey pressed but Accessibility not granted — prompting onboarding")
            }
            isCapturing = false
            onNeedsAccessibility?()
            return
        }
        // First trusted pass (or first after a re-grant): pin this binary's
        // hash so a later trust loss is explainable.
        TrustMonitor.recordTrusted()

        let placementRaw = UserDefaults.standard.string(forKey: SettingsKeys.panelPlacement)
        let placement = PanelPlacement(rawValue: placementRaw ?? "") ?? .nearCursor
        let corner = PanelPlacement.Corner(rawValue: UserDefaults.standard.string(forKey: SettingsKeys.panelCorner) ?? "") ?? .topRight
        let restorePref = UserDefaults.standard.object(forKey: SettingsKeys.restoreClipboard) as? Bool ?? true

        // Panel must appear instantly with a spinner, before any slow work (TRD 6).
        panelController.show(
            state: .loading,
            near: placement == .nearCursor ? NSEvent.mouseLocation : nil,
            in: corner
        )

        Task {
            let outcome = await captureService.captureSelection(in: targetApp)

            guard let text = outcome.text else {
                self.handleCaptureFailure(outcome.diagnostics)
                return
            }

            await self.extractAndShow(
                text,
                restoreClipboard: restorePref ? outcome.restoreClipboard : nil
            )
        }
    }

    /// Panel went away for any reason. If extraction is still in flight,
    /// swallow the pending result; otherwise the flow is idle again.
    private func handlePanelDismiss() {
        if isCapturing {
            isDismissedDuringCapture = true
        } else {
            isCapturing = false
        }
    }

    private func extractAndShow(
        _ conversation: String,
        restoreClipboard: (() -> Void)?
    ) async {
        let defaults = UserDefaults.standard
        let backend = BackendFactory.make(
            backendType: defaults.string(forKey: SettingsKeys.backendType) ?? "",
            // Task 4c: the key lives in the Keychain, not UserDefaults.
            anthropicAPIKey: KeychainHelper.load() ?? "",
            ollamaHost: defaults.string(forKey: SettingsKeys.ollamaHost) ?? OllamaBackend.defaultHost,
            ollamaModel: defaults.string(forKey: SettingsKeys.ollamaModel) ?? OllamaBackend.defaultModel
        )

        do {
            let card = try await backend.extractContext(from: conversation)
            restoreClipboard?()
            // Task 4b: a malformed card is still delivered, but in a dedicated
            // needs-review state so it's clearly not a clean success.
            let state: FloatingPanelController.State
            if let warning = ExtractionWarning.shared.consume() {
                state = .needsReview(card: card, warning: warning)
            } else {
                state = .success(card)
                CaptureFeedback.playSuccessIfEnabled()
            }
            presentOutcome(state)
            onCaptureSucceeded?()
        } catch {
            _ = ExtractionWarning.shared.consume() // reset for the next run
            restoreClipboard?()
            CaptureFeedback.playFailureIfEnabled()
            presentOutcome(.failure(error.localizedDescription, diagnostics: ""))
        }
    }

    private func showFailure(_ message: String, diagnostics: String) {
        presentOutcome(.failure(message, diagnostics: diagnostics))
    }

    /// Capture came back empty. Optionally copy the diagnostics trail to the
    /// clipboard (Settings toggle) so it's ready to paste into a bug report —
    /// safe to write here: on this path the pipeline never took the clipboard
    /// over, so there's no pending restore to fight with.
    private func handleCaptureFailure(_ diagnostics: String) {
        CaptureFeedback.playFailureIfEnabled()
        let copyTrail = UserDefaults.standard.object(forKey: SettingsKeys.copyCaptureTrailOnFailure) as? Bool ?? false
        if copyTrail, !diagnostics.isEmpty {
            let pasteboard = NSPasteboard.general
            pasteboard.clearContents()
            pasteboard.setString(diagnostics, forType: .string)
        }
        showFailure(
            copyTrail && !diagnostics.isEmpty
                ? "Nothing captured — select some text in the app you're using, then press the shortcut again. Trail copied to clipboard."
                : "Nothing captured — select some text in the app you're using, then press the shortcut again.",
            diagnostics: diagnostics
        )
    }

    /// Ends the cycle. If the user dismissed the panel meanwhile, the result
    /// is dropped; otherwise it's shown. Runs on the main actor, so there's
    /// no race between the dismissal check and showing the panel.
    private func presentOutcome(_ state: FloatingPanelController.State) {
        isCapturing = false
        defer { isDismissedDuringCapture = false }
        guard !isDismissedDuringCapture else { return }
        panelController.show(
            state: state,
            near: placementPoint(),
            in: corner()
        )
    }

    private func placementPoint() -> NSPoint? {
        let placement = PanelPlacement(
            rawValue: UserDefaults.standard.string(forKey: SettingsKeys.panelPlacement) ?? ""
        ) ?? .nearCursor
        return placement == .nearCursor ? NSEvent.mouseLocation : nil
    }

    private func corner() -> PanelPlacement.Corner {
        PanelPlacement.Corner(
            rawValue: UserDefaults.standard.string(forKey: SettingsKeys.panelCorner) ?? ""
        ) ?? .topRight
    }
}
