import AppKit
import Carbon.HIToolbox
import Foundation

/// Deterministic ownership check for a key combo: actually asks the system
/// whether the combo can be registered as a system-wide hotkey.
///
/// Replaces the old "wait 3s for a keypress" heuristic, whose timeout always
/// fired "not detected — another app owns it" whenever the user pressed the
/// combo late (or not at all) — a false accusation most of the time.
///
/// How it works: `RegisterEventHotKey` fails with `eventHotKeyExistsErr`
/// when ANOTHER app already owns the combo, and succeeds when the combo is
/// free (we unregister immediately, so nothing observable changes; our own
/// NSEvent monitors stay the live capture path).
enum HotKeyProbe {
    enum Ownership {
        /// RegisterEventHotKey succeeded — no other app owns the combo.
        case free
        /// The system refused: another application holds this exact combo.
        case takenByOtherApp
        /// The system refused for a different reason (rare).
        case failed(OSStatus)
    }

    static func check(_ combo: HotKeyCombo) -> Ownership {
        let hotKeyID = EventHotKeyID(signature: OSType(0x43544853 /* 'CTHS' */), id: 0)
        var ref: EventHotKeyRef?
        let mods = carbonModifiers(fromNSEventRaw: combo.modifiers)

        let status = RegisterEventHotKey(
            combo.keyCode,
            mods,
            hotKeyID,
            GetApplicationEventTarget(),
            0,
            &ref
        )
        if let ref { UnregisterEventHotKey(ref) }

        switch status {
        case noErr:
            return .free
        case OSStatus(eventHotKeyExistsErr):
            return .takenByOtherApp
        default:
            return .failed(status)
        }
    }

    /// `HotKeyCombo.modifiers` stores NSEvent raw values (command = 1 << 20),
    /// while RegisterEventHotKey expects Carbon modifier masks (cmdKey =
    /// 1 << 8). Without this conversion the probe passes meaningless bits and
    /// would report false "combo is free" verdicts.
    static func carbonModifiers(fromNSEventRaw raw: UInt) -> UInt32 {
        let flags = NSEvent.ModifierFlags(rawValue: raw)
        var carbon: UInt32 = 0
        if flags.contains(.command) { carbon |= UInt32(cmdKey) }
        if flags.contains(.option) { carbon |= UInt32(optionKey) }
        if flags.contains(.control) { carbon |= UInt32(controlKey) }
        if flags.contains(.shift) { carbon |= UInt32(shiftKey) }
        return carbon
    }
}
