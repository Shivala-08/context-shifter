import AppKit

/// Registers the global hotkey via NSEvent.addGlobalMonitorForEvents and also
/// watches local events so the shortcut works while our own UI is frontmost.
/// Global monitoring requires the app to be Accessibility-trusted (checked by
/// AccessibilityOnboarding before this manager is started).
final class GlobalHotKeyManager {
    var handler: (() -> Void)?

    private var combo: HotKeyCombo
    private var globalMonitor: Any?
    private var localMonitor: Any?

    init(combo: HotKeyCombo) {
        self.combo = combo
    }

    func updateCombo(_ newCombo: HotKeyCombo) {
        combo = newCombo
        restart()
    }

    func start() {
        guard globalMonitor == nil else { return }
        startMonitors()
    }

    func stop() {
        if let globalMonitor { NSEvent.removeMonitor(globalMonitor) }
        if let localMonitor { NSEvent.removeMonitor(localMonitor) }
        globalMonitor = nil
        localMonitor = nil
    }

    private func restart() {
        stop()
        startMonitors()
    }

    /// Only the four user-assignable modifiers participate in matching.
    /// (deviceIndependentFlagsMask also carries .capsLock and .function, so
    /// comparing against it made the shortcut silently dead whenever Caps
    /// Lock was on.)
    private static let hotKeyFlags: NSEvent.ModifierFlags = [.command, .shift, .option, .control]

    private func startMonitors() {
        let wanted = combo.modifiers
        let keyCode = combo.keyCode

        globalMonitor = NSEvent.addGlobalMonitorForEvents(matching: .keyDown) { [weak self] event in
            guard let self,
                  event.keyCode == keyCode,
                  event.modifierFlags.intersection(Self.hotKeyFlags).rawValue == wanted
            else { return }
            self.handler?()
        }

        // Local monitor: fires when our own panel/window has key focus.
        localMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            guard let self,
                  event.keyCode == keyCode,
                  event.modifierFlags.intersection(Self.hotKeyFlags).rawValue == wanted
            else { return event }
            self.handler?()
            return nil // consumed
        }
    }
}
