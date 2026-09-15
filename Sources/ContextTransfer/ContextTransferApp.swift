import SwiftUI

/// Phase 2 — the app is a menu bar agent (LSUIElement): no window on launch.
/// The AppDelegate owns the status item, global hotkey, and the manually
/// hosted paste-in window; the SwiftUI `Settings` scene provides Settings….
@main
struct ContextTransferApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

    var body: some Scene {
        Settings {
            SettingsView()
        }
    }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    private var statusItemController: StatusItemController?
    private var hotKeyManager: GlobalHotKeyManager?
    private var pasteInWindowController: NSWindowController?
    private let orchestrator = CaptureOrchestrator()

    func applicationDidFinishLaunching(_ notification: Notification) {
        orchestrator.onNeedsAccessibility = { [weak self] in
            self?.promptForAccessibility()
        }
        // TRD 5: positive confirmation that the hotkey did something — the
        // status item flashes for ~1s on a successful capture.
        orchestrator.onCaptureSucceeded = { [weak self] in
            self?.statusItemController?.flash()
        }

        let statusController = StatusItemController(
            onOpenSettings: { [weak self] in self?.openSettings() },
            onOpenPasteInWindow: { [weak self] in self?.openPasteInWindow() },
            onToggleCapture: { [weak self] in
                // Covers the "user granted Accessibility manually in System
                // Settings" path: the monitors were never installed at launch
                // (untrusted), and the hotkey can't trigger the onboarding
                // flow itself. This click installs them without a relaunch.
                self?.installHotKeyManagerIfTrusted()
                self?.orchestrator.triggerCapture()
            }
        )
        statusItemController = statusController
        statusController.install(status: AccessibilityOnboarding.isTrusted() ? .ready : .noAccessibility)

        // Re-recorded shortcut in Settings applies immediately (no relaunch).
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(hotKeySettingChanged),
            name: .hotKeySettingChanged,
            object: nil
        )

        startHotKeyIfTrusted()

        // Launch trusted? Pin this binary's hash so a later rebuild (different
        // signature → macOS revokes trust) is diagnosable, not baffling.
        if AccessibilityOnboarding.isTrusted() {
            TrustMonitor.recordTrusted()
        } else if TrustMonitor.grantBelongsToDifferentBuild {
            CaptureLogger.orchestrator.info("launch untrusted: \(TrustMonitor.rebuiltBinaryTrailNote, privacy: .public)")
        }

        // Latency: load the local model into memory before the user's first
        // capture, so cold-start cost lands at launch, not mid-workflow.
        OllamaBackend.warmUpInBackground()
    }

    /// A menu-bar agent with LSUIElement has no Dock icon and no window — when
    /// its status item is hidden (menu bar overflow behind the notch, hidden
    /// by a menu bar manager, …) the app appears completely absent: double-
    /// clicking it in Finder does nothing visible. So on a genuine re-launch
    /// while already running, surface the status item's menu — the app's one
    /// piece of UI — instead of failing silently.
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag {
            statusItemController?.showMenu()
        }
        return true
    }

    func applicationWillTerminate(_ notification: Notification) {
        hotKeyManager?.stop()
    }

    /// Installs monitors only when already trusted; onboarding otherwise
    /// happens on first real capture attempt (TRD 5: prompt on first use,
    /// not at launch).
    private func startHotKeyIfTrusted() {
        guard AccessibilityOnboarding.isTrusted() else { return }
        installHotKeyManager()
    }

    /// Installs the hotkey monitors when trusted; no-op otherwise. Safe to
    /// call repeatedly (installHotKeyManager guards against double-install).
    private func installHotKeyManagerIfTrusted() {
        guard AccessibilityOnboarding.isTrusted() else { return }
        installHotKeyManager()
        statusItemController?.updateStatus(.ready)
    }

    /// Installs the hotkey monitors if Accessibility trust exists, without
    /// complaining otherwise. Called before the Settings "Test shortcut"
    /// check runs and when the Settings trust banner sees the grant arrive:
    /// if the monitors were never installed (untrusted at launch, or a
    /// rebuild dropped the grant), the test would report a false "owned by
    /// another app" verdict. Verifying trust here gives the real answer.
    func ensureHotKeyMonitors() {
        installHotKeyManagerIfTrusted()
    }

    /// True once the global key monitors are installed (requires trust).
    /// Read by Settings' "Run diagnostics" self-check.
    var hotKeyMonitorsActive: Bool { hotKeyManager != nil }

    private func installHotKeyManager() {
        guard hotKeyManager == nil else { return }
        let manager = GlobalHotKeyManager(combo: currentCombo())
        manager.handler = { [weak self] in
            Task { @MainActor in
                // Settings' "Test shortcut" (TRD 3.2) listens for this to
                // verify the combo actually reaches the app.
                NotificationCenter.default.post(name: .hotKeyDetected, object: nil)
                self?.orchestrator.triggerCapture()
            }
        }
        manager.start()
        hotKeyManager = manager
    }

    private func currentCombo() -> HotKeyCombo {
        let raw = UserDefaults.standard.string(forKey: SettingsKeys.hotKey) ?? ""
        return HotKeyCodec.decode(raw) ?? .default
    }

    @objc private func hotKeySettingChanged() {
        if hotKeyManager != nil {
            hotKeyManager?.updateCombo(currentCombo())
        } else {
            // Monitors were never installed (untrusted at launch). Try now —
            // trust may have been granted since launch — so a newly recorded
            // combo actually becomes live instead of staying dead.
            installHotKeyManagerIfTrusted()
        }
    }

    /// Runs the onboarding flow; on grant, starts the hotkey monitors.
    private func promptForAccessibility() {
        let anchor = pasteInWindowController?.window
            ?? NSApp.windows.first { !$0.isKind(of: NSPanel.self) }
        AccessibilityOnboarding.requestTrust(from: anchor) { [weak self] in
            Task { @MainActor in
                self?.installHotKeyManager()
                self?.statusItemController?.updateStatus(.ready)
            }
        }
    }

    /// Opens the native Settings scene window. Preferred path: fire SwiftUI's
    /// own "Settings…" application-menu item — its action is whatever the
    /// current OS/SwiftUI expects, so this is version-proof (macOS 13 used
    /// `showPreferencesWindow:`, 14+ uses `showSettingsWindow:`, later
    /// releases may differ again). Selector + window fallbacks follow.
    private func openSettings() {
        NSApp.activate(ignoringOtherApps: true)

        if let settingsItem = NSApp.mainMenu?.items.first?.submenu?.items.first(where: {
            $0.action != nil && $0.title.localizedCaseInsensitiveContains("Settings")
        }), let action = settingsItem.action,
           NSApp.sendAction(action, to: settingsItem.target, from: settingsItem) {
            return
        }

        let showed = NSApp.sendAction(Selector(("showSettingsWindow:")), to: nil, from: nil)
            || NSApp.sendAction(Selector(("showPreferencesWindow:")), to: nil, from: nil)
        if !showed {
            // Fallback: make any existing settings window key.
            NSApp.windows.first {
                $0.identifier?.rawValue.lowercased().contains("settings") == true
            }?.makeKeyAndOrderFront(nil)
        }
    }

    /// Manually hosted Phase 1 paste-in window (no WindowGroup, so it never
    /// appears on launch — only when explicitly opened from the menu).
    private func openPasteInWindow() {
        if let controller = pasteInWindowController {
            controller.showWindow(nil)
            controller.window?.makeKeyAndOrderFront(nil)
            NSApp.activate(ignoringOtherApps: true)
            return
        }

        let contentView = ContentView()
        let window = NSWindow(contentViewController: NSHostingController(rootView: contentView))
        window.title = "Context Transfer"
        window.styleMask = [.titled, .closable, .miniaturizable, .resizable]
        window.contentMinSize = NSSize(width: 900, height: 600)
        window.setContentSize(NSSize(width: 980, height: 640))
        window.center()
        window.isReleasedWhenClosed = false

        pasteInWindowController = NSWindowController(window: window)
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }
}
