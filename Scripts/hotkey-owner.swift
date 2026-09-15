import AppKit
import Carbon.HIToolbox
import Foundation

// Diagnostic: who owns a key combo on this machine?
// Usage: swift Scripts/hotkey-owner.swift [keyCode] [NSEvent-modifier-raw]
// With no args, checks the app's default ⌘⇧X (keyCode 7, cmd+shift).
//
// Method 1 — probe: RegisterEventHotKey fails with eventHotKeyExistsErr when
// another app holds the combo (same check the app's Test shortcut performs,
// with the same NSEvent→Carbon modifier conversion).
//
// Method 2 — heuristics: lists running GUI apps plus a small table of apps
// known to ship with ⌘⇧X-bound defaults, to name likely owners.

let args = CommandLine.arguments
let keyCode: UInt32 = args.count > 1 ? UInt32(args[1]) ?? 7 : 7            // kVK_ANSI_X
let modRaw: UInt = args.count > 2 ? UInt(args[2]) ?? 0 : 0                 // placeholder, replaced below

// NSEvent.ModifierFlags raw for ⌘⇧ (command 1<<20 | shift 1<<17).
let defaultCmdShift: UInt = (1 << 20) | (1 << 17)
let modifiers: UInt = args.count > 2 ? modRaw : defaultCmdShift

let flags = NSEvent.ModifierFlags(rawValue: modifiers)
var carbon: UInt32 = 0
if flags.contains(.command) { carbon |= UInt32(cmdKey) }
if flags.contains(.option) { carbon |= UInt32(optionKey) }
if flags.contains(.control) { carbon |= UInt32(controlKey) }
if flags.contains(.shift) { carbon |= UInt32(shiftKey) }

// Same key naming as the app's HotKeyCodec for readable output.
func keyName(_ code: UInt32) -> String {
    let named: [UInt32: String] = [
        0: "A", 1: "S", 2: "D", 3: "F", 4: "H", 5: "G", 6: "Z", 7: "X",
        8: "C", 9: "V", 10: "N", 11: "B", 12: "Q", 13: "W", 14: "E",
        15: "R", 16: "Y", 17: "T", 18: "1", 19: "2", 20: "3", 21: "4",
        22: "6", 23: "5", 25: "9", 26: "7", 28: "8", 29: "0", 31: "O",
        32: "U", 34: "I", 35: "P", 36: "Return", 37: "L", 38: "J",
        39: "'", 40: "K", 41: ";", 43: ",", 44: "/", 45: "M", 46: ".",
        47: "Space", 48: "Tab", 49: "Space", 51: "Delete", 53: "Escape",
        96: "F5", 97: "F6", 98: "F7", 99: "F3", 100: "F8", 101: "F9",
        109: "F10", 103: "F11", 111: "F12", 105: "F13", 107: "F14",
        113: "F15", 118: "F4", 119: "Home", 120: "F2", 121: "Page Up",
        122: "F1", 123: "←", 124: "→", 125: "↓", 126: "↑",
    ]
    return named[code] ?? "Key \(code)"
}

var comboString = ""
if flags.contains(.control) { comboString += "⌃" }
if flags.contains(.option) { comboString += "⌥" }
if flags.contains(.shift) { comboString += "⇧" }
if flags.contains(.command) { comboString += "⌘" }
comboString += keyName(keyCode)

print("Probing combo: \(comboString)  (keyCode \(keyCode), NSEvent raw \(modifiers), Carbon mask \(carbon))")
print("---")

// --- Method 1: system probe ---------------------------------------------
let hotKeyID = EventHotKeyID(signature: OSType(0x44494147 /* 'DIAG' */), id: 0)
var ref: EventHotKeyRef?
let status = RegisterEventHotKey(keyCode, carbon, hotKeyID, GetApplicationEventTarget(), 0, &ref)
if let ref { UnregisterEventHotKey(ref) }

switch status {
case noErr:
    print("PROBE: the combo is FREE — no other app holds it as a system hotkey.")
    print("       (If capture still does nothing with this verdict, the problem is")
    print("        Accessibility trust or the app's monitors, not a collision.)")
case OSStatus(eventHotKeyExistsErr):
    print("PROBE: TAKEN — another application owns this exact combo system-wide.")
case let other:
    print("PROBE: RegisterEventHotKey failed with OSStatus \(other) (unexpected).")
}
print("---")

// --- Method 2: running apps + known-owners table -------------------------
print("Running GUI apps (candidates for the owner):")
let workspace = NSWorkspace.shared
let apps = workspace.runningApplications.filter { $0.activationPolicy == .regular }
for app in apps.sorted(by: { $0.localizedName ?? "" < $1.localizedName ?? "" }) {
    print("  • \(app.localizedName ?? "?")  (\(app.bundleIdentifier ?? "?"))")
}

print("")
print("Apps KNOWN to register ⌘⇧X by default (cross-check with the list above):")
let knownOwners: [(String, String)] = [
    ("com.raycast.macos", "Raycast — ⌘⇧X is a common user-bound command"),
    ("com.crowdcafe.windowmagnet", "Window Magnet — default ⌘⇧X layout shortcut"),
    ("com.manytricks.moom", "Moom — some default layouts use ⌘⇧X"),
    ("com.hegenberg.BetterTouchTool", "BetterTouchTool — user-assigned actions often use ⌘⇧X"),
    ("com.kapeli.dashdoc", "Dash — default 'Add to cheat sheet' is ⌘⇧X in some versions"),
    ("com.apple.finder", "Finder — user-mappable; not default ⌘⇧X, listed for reference"),
]
let runningIDs = Set(apps.compactMap { $0.bundleIdentifier })
var namedAny = false
for (bundleID, note) in knownOwners where runningIDs.contains(bundleID) {
    print("  • \(bundleID) — \(note)")
    namedAny = true
}
if !namedAny {
    print("  (none of the usual suspects are running — if PROBE said TAKEN, check")
    print("   System Settings → Keyboard → Keyboard Shortcuts → App Shortcuts, and")
    print("   any launcher/automation utility's own settings)")
}
