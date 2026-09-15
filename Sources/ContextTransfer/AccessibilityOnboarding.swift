import AppKit
import ApplicationServices

/// Checks Accessibility trust and, when missing, drives a one-time onboarding
/// sheet that explains the permission and opens the right System Settings pane.
/// Polls until the user grants, then calls back.
enum AccessibilityOnboarding {
    static func isTrusted() -> Bool {
        AXIsProcessTrusted()
    }

    /// Presents the explanation sheet on the given window and polls every
    /// second until `AXIsProcessTrusted()` flips true (up to ~10 minutes).
    static func requestTrust(from window: NSWindow?, completion: @escaping () -> Void) {
        if isTrusted() {
            completion()
            return
        }

        let alert = NSAlert()
        alert.messageText = "Allow Context Transfer to watch for the capture shortcut"
        var informative = """
        Quick capture needs Accessibility access so the app can:
        1. Detect the global shortcut (⌘⇧X by default) from any app
        2. Send a single ⌘C to copy your current text selection

        Your clipboard is restored afterwards and nothing is stored.
        """
        // The baffling case: System Settings shows an allowed entry, but it
        // belongs to an older build whose signature no longer matches. Name
        // it explicitly, or the user thinks the toggle is broken.
        if TrustMonitor.grantBelongsToDifferentBuild {
            informative += "\n\n" + TrustMonitor.rebuiltBinaryExplanation
        }
        alert.informativeText = informative
        alert.addButton(withTitle: "Open System Settings")
        alert.addButton(withTitle: "Not Now")
        alert.alertStyle = .informational

        // Ask macOS to show its own approval dialog AND auto-insert the app
        // into the Accessibility list — otherwise the user has to find the
        // .app manually via "+". Called each poll in case they closed it.
        let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
        _ = AXIsProcessTrustedWithOptions(options)

        let runAlertAndPoll = {
            // A sheet on an INVISIBLE window is invisible: LSUIElement apps
            // carry SwiftUI infrastructure windows that are never on screen,
            // and the old `first non-panel window` choice happily picked one
            // — the alert silently attached to it and nothing appeared.
            // Sheet only onto a window that's actually visible; otherwise
            // activate the app and run a real app-modal alert.
            let visibleAnchor = window.flatMap { $0.isVisible ? $0 : nil }
            if let window = visibleAnchor {
                alert.beginSheetModal(for: window) { response in
                    if response == .alertFirstButtonReturn {
                        openAccessibilitySettings()
                    }
                }
            } else {
                // LSUIElement apps run in the background: a modal alert shown
                // without activating the app is INVISIBLE — the user sees
                // nothing while the app blocks on runModal. Activate first
                // so the explanation actually appears on screen.
                NSApp.activate(ignoringOtherApps: true)
                if alert.runModal() == .alertFirstButtonReturn {
                    openAccessibilitySettings()
                }
            }

            // The run loop retains the timer while it's scheduled, so no
            // local reference is needed to keep it alive. Added to .common
            // so it keeps firing while a modal alert session is up (the
            // default mode pauses during runModal, which would stall grant
            // detection until the alert is dismissed).
            let timer = Timer(timeInterval: 1.0, repeats: true) { timer in
                if isTrusted() {
                    timer.invalidate()
                    // Pin THIS binary's hash the moment the grant lands so a
                    // future rebuild is diagnosable instead of baffling.
                    TrustMonitor.recordTrusted()
                    completion()
                }
            }
            RunLoop.main.add(timer, forMode: .common)
        }

        if Thread.isMainThread {
            runAlertAndPoll()
        } else {
            DispatchQueue.main.sync(execute: runAlertAndPoll)
        }
    }

    static func openAccessibilitySettings() {
        let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")!
        NSWorkspace.shared.open(url)
    }
}
