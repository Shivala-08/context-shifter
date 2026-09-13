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
        alert.informativeText = """
        Quick capture needs Accessibility access so the app can:
        1. Detect the global shortcut (⌘⇧X by default) from any app
        2. Send a single ⌘C to copy your current text selection

        Your clipboard is restored afterwards and nothing is stored.
        """
        alert.addButton(withTitle: "Open System Settings")
        alert.addButton(withTitle: "Not Now")
        alert.alertStyle = .informational

        // Re-prompt macOS's own dialog each poll in case the user closed it.
        let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: false] as CFDictionary
        _ = AXIsProcessTrustedWithOptions(options)

        let runAlertAndPoll = {
            if let window {
                alert.beginSheetModal(for: window) { response in
                    if response == .alertFirstButtonReturn {
                        openAccessibilitySettings()
                    }
                }
            } else {
                if alert.runModal() == .alertFirstButtonReturn {
                    openAccessibilitySettings()
                }
            }
            // The run loop retains the timer while it's scheduled, so no
            // local reference is needed to keep it alive.
            Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { timer in
                if isTrusted() {
                    timer.invalidate()
                    completion()
                }
            }
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
