import AppKit
import Carbon.HIToolbox
import SwiftUI

/// Borderless, non-activating, floating NSPanel hosting the SwiftUI card view.
/// Does not steal focus from the app the user was working in. Dismisses on
/// click-away, Esc, hotkey re-press, or Copy (auto-dismiss).
final class FloatingPanelController {
    /// Why the panel is currently visible, if it is.
    enum State {
        case loading
        case success(String)
        /// Card returned but failed format validation even after one retry —
        /// shown with a warning band, not as a flat failure.
        case needsReview(card: String, warning: String)
        /// Capture/extraction error. `diagnostics` is the optional step-by-step
        /// trail of what the capture pipeline tried (shown small under the
        /// message); empty for extraction errors, which have no capture trail.
        case failure(String, diagnostics: String)
    }

    private var panel: NSPanel?
    private var dismissWorkItem: DispatchWorkItem?
    private var eventMonitors: [Any] = []

    var onDismiss: (() -> Void)?

    func show(state: State, near point: NSPoint?, in corner: PanelPlacement.Corner) {
        installDismissMonitors()

        let content = PanelContentView(
            state: state,
            onCopy: { [weak self] in self?.scheduleAutoDismiss(seconds: 2.5) },
            onClose: { [weak self] in self?.dismiss() }
        )
        let hosting = NSHostingView(rootView: content)
        let targetSize = hosting.fittingSize

        let panel = self.panel ?? makePanel()
        panel.contentView = hosting
        panel.setContentSize(targetSize)
        panel.setFrameTopLeftPoint(Self.origin(for: targetSize, near: point, in: corner))
        panel.orderFrontRegardless() // no activate: never steals focus
        self.panel = panel
    }

    func dismiss() {
        removeDismissMonitors()
        dismissWorkItem?.cancel()
        panel?.orderOut(nil)
        panel = nil
        onDismiss?()
    }

    var isVisible: Bool { panel?.isVisible ?? false }

    /// Click-away + Esc dismissal. Global monitors cover other apps (the
    /// panel is non-activating, so it's never the key window itself); a local
    /// monitor covers Esc while OUR windows are frontmost (e.g. the paste-in
    /// window), which global monitors never see.
    private func installDismissMonitors() {
        guard eventMonitors.isEmpty else { return }

        if let monitor = NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown], handler: { [weak self] event in
            guard let self, let panel = self.panel, panel.isVisible else { return }
            // Ignore clicks on the panel itself (e.g. the Copy button).
            let location = NSEvent.mouseLocation
            if !panel.frame.contains(location) {
                self.dismiss()
            }
        }) {
            eventMonitors.append(monitor)
        }

        if let monitor = NSEvent.addGlobalMonitorForEvents(matching: .keyDown, handler: { [weak self] event in
            guard let self, let panel = self.panel, panel.isVisible else { return }
            if event.keyCode == UInt16(kVK_Escape) {
                self.dismiss()
            }
        }) {
            eventMonitors.append(monitor)
        }

        if let monitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown, handler: { [weak self] event in
            guard let self, let panel = self.panel, panel.isVisible,
                  event.keyCode == UInt16(kVK_Escape)
            else { return event }
            self.dismiss()
            return nil // consumed
        }) {
            eventMonitors.append(monitor)
        }
    }

    private func removeDismissMonitors() {
        eventMonitors.forEach { NSEvent.removeMonitor($0) }
        eventMonitors.removeAll()
    }

    private func makePanel() -> NSPanel {
        let panel = NSPanel(
            contentRect: .zero,
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        panel.level = .floating
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = true
        panel.isMovable = false
        panel.hidesOnDeactivate = false
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        panel.standardWindowButton(.closeButton)?.isHidden = true
        return panel
    }

    private func scheduleAutoDismiss(seconds: TimeInterval) {
        dismissWorkItem?.cancel()
        let item = DispatchWorkItem { [weak self] in self?.dismiss() }
        dismissWorkItem = item
        DispatchQueue.main.asyncAfter(deadline: .now() + seconds, execute: item)
    }

    private static func origin(for size: NSSize, near point: NSPoint?, in corner: PanelPlacement.Corner) -> NSPoint {
        guard let screen = NSScreen.main ?? NSScreen.screens.first else { return .zero }
        let visible = screen.visibleFrame

        if let point {
            // Near the cursor, nudged so the panel stays fully on-screen.
            let x = min(max(point.x, visible.minX + 8), visible.maxX - size.width - 8)
            let y = min(max(point.y - size.height - 16, visible.minY + 8), visible.maxY - size.height - 8)
            return NSPoint(x: x, y: y + size.height)
        }

        let margin: CGFloat = 12
        switch corner {
        case .topRight:
            return NSPoint(x: visible.maxX - size.width - margin, y: visible.maxY - margin)
        case .bottomRight:
            return NSPoint(x: visible.maxX - size.width - margin, y: visible.minY + margin + size.height)
        case .topLeft:
            return NSPoint(x: visible.minX + margin, y: visible.maxY - margin)
        case .bottomLeft:
            return NSPoint(x: visible.minX + margin, y: visible.minY + margin + size.height)
        }
    }
}
