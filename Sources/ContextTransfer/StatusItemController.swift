import AppKit

/// Owns the NSStatusItem (menu bar icon, no Dock icon thanks to LSUIElement).
final class StatusItemController: NSObject, NSMenuDelegate {
    enum Status {
        case ready
        case noAccessibility

        var tooltip: String {
            switch self {
            case .ready: return "Context Transfer — select text anywhere, then press the capture shortcut"
            case .noAccessibility: return "Context Transfer — Accessibility permission needed for quick capture"
            }
        }
    }

    private var statusItem: NSStatusItem?
    private var flashWorkItem: DispatchWorkItem?
    private let onOpenSettings: () -> Void
    private let onOpenPasteInWindow: () -> Void
    private let onToggleCapture: () -> Void

    init(onOpenSettings: @escaping () -> Void,
         onOpenPasteInWindow: @escaping () -> Void,
         onToggleCapture: @escaping () -> Void) {
        self.onOpenSettings = onOpenSettings
        self.onOpenPasteInWindow = onOpenPasteInWindow
        self.onToggleCapture = onToggleCapture
        super.init()
    }

    func install(status: Status) {
        let item = statusItem ?? NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        statusItem = item

        item.button?.image = NSImage(systemSymbolName: "arrow.left.arrow.right.square", accessibilityDescription: "Context Transfer")
        item.button?.toolTip = status.tooltip

        let menu = NSMenu()
        menu.delegate = self

        let capture = NSMenuItem(title: "Quick Capture", action: #selector(toggleCapture), keyEquivalent: "")
        capture.target = self
        menu.addItem(capture)

        let pasteIn = NSMenuItem(title: "Paste-in Window…", action: #selector(openPasteInWindow), keyEquivalent: "")
        pasteIn.target = self
        menu.addItem(pasteIn)

        let settings = NSMenuItem(title: "Settings…", action: #selector(openSettings), keyEquivalent: ",")
        settings.target = self
        menu.addItem(settings)

        menu.addItem(.separator())

        let quit = NSMenuItem(title: "Quit Context Transfer", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        menu.addItem(quit)

        item.menu = menu
    }

    func updateStatus(_ status: Status) {
        install(status: status)
    }

    /// Pops the status item's menu open programmatically — the app's only UI
    /// when its icon is hidden by menu bar overflow, so a Finder double-click
    /// on an already-running instance still lands somewhere visible.
    func showMenu() {
        guard let button = statusItem?.button else { return }
        // Confirm the icon is actually on a visible screen before relying on
        // it; if it's parked off-screen (notch overflow), open the menu from
        // a temporary item that's guaranteed visible instead.
        let onScreen = NSScreen.screens.contains { $0.frame.contains(button.window?.frame ?? .zero) }
        if onScreen {
            button.performClick(nil)
        } else {
            let visibleItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
            visibleItem.button?.image = NSImage(systemSymbolName: "arrow.left.arrow.right.square", accessibilityDescription: "Context Transfer")
            visibleItem.menu = statusItem?.menu
            // Pull the menu down under the (now visible) icon.
            visibleItem.button?.performClick(nil)
            // Remove the temporary item once the menu closes.
            DispatchQueue.main.asyncAfter(deadline: .now() + 5) {
                NSStatusBar.system.removeStatusItem(visibleItem)
            }
        }
    }

    /// TRD 5: briefly swap to a filled/highlighted icon for ~1s so there's
    /// positive confirmation a capture succeeded (easy-to-miss menu bar glyph
    /// otherwise gives zero feedback).
    func flash() {
        guard let item = statusItem else { return }
        item.button?.image = NSImage(systemSymbolName: "arrow.left.arrow.right.square.fill", accessibilityDescription: "Context Transfer — captured")

        flashWorkItem?.cancel()
        let work = DispatchWorkItem { [weak self] in
            guard let self, let item = self.statusItem else { return }
            item.button?.image = NSImage(systemSymbolName: "arrow.left.arrow.right.square", accessibilityDescription: "Context Transfer")
        }
        flashWorkItem = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.0, execute: work)
    }

    // NSMenuDelegate: opening the menu means the app must briefly become the
    // active app so its menu items can receive clicks.
    func menuWillOpen(_ menu: NSMenu) {
        NSApp.activate(ignoringOtherApps: true)
    }

    @objc private func openSettings() {
        onOpenSettings()
    }

    @objc private func openPasteInWindow() {
        onOpenPasteInWindow()
    }

    @objc private func toggleCapture() {
        onToggleCapture()
    }
}
