import AppKit
import Carbon.HIToolbox

/// When the Test-shortcut probe says the combo is TAKEN, this names the
/// likely owner: it scans running GUI apps and cross-references apps known
/// to ship ⌘⇧X-style defaults, producing a short human-readable report that
/// Settings shows inline (and can copy for a bug report).
///
/// Limits, stated honestly in the report: macOS gives no API to enumerate
/// registered hotkeys, so this is a best-effort scan — Carbon-registered
/// shortcuts (the usual collision source) don't show up in System Settings
/// either.
enum HotKeyCollisionDiagnostics {
    struct Suspect {
        let bundleID: String
        let name: String
        let note: String
    }

    /// Apps commonly seen grabbing ⌘⇧X-ish combos by default.
    private static let knownDefaultOwners: [String: String] = [
        "com.raycast.macos": "Raycast (user-bound commands often use ⌘⇧X)",
        "com.crowdcafe.windowmagnet": "Window Magnet (default layout shortcuts)",
        "com.manytricks.moom": "Moom (custom hotkeys)",
        "com.hegenberg.BetterTouchTool": "BetterTouchTool (user-assigned actions)",
        "com.alienator88.Snow": "Snow (window management)",
        "com.kapeli.dashdoc": "Dash",
        "net.mattparkes.RectanglePro": "Rectangle Pro",
        "com.superultra.SuperUltraFocus": "Focus tools",
    ]

    /// Names of running apps whose default shortcut tables include ⌘⇧X in
    /// some versions — matched by name because bundle IDs vary by region/
    /// version. Conservative: reported as "check this one", not "the owner".
    private static let suspectNameFragments: [(fragment: String, note: String)] = [
        ("raycast", "Raycast — check Settings → Extensions → Hotkeys"),
        ("moom", "Moom — check its hotkey settings"),
        ("bettertouchtool", "BetterTouchTool — check its action shortcuts"),
        ("magnet", "Magnet — check menu bar → Preferences → Shortcuts"),
        ("rectangle", "Rectangle — check its preferences"),
        ("keyboard maestro", "Keyboard Maestro — check its macro palettes"),
        ("alfred", "Alfred — check Preferences → Workflows"),
        ("launcher", "A launcher utility — check its hotkey settings"),
    ]

    /// Builds the report shown in Settings. Never blocks: pure in-memory
    /// scan of NSWorkspace state.
    static func report(for combo: HotKeyCombo) -> String {
        let comboText = HotKeyCodec.displayString(combo)
        let running = NSWorkspace.shared.runningApplications
            .filter { $0.activationPolicy == .regular }
            .compactMap { app -> Suspect? in
                guard let bundleID = app.bundleIdentifier else { return nil }
                let name = app.localizedName ?? bundleID
                if let note = knownDefaultOwners[bundleID] {
                    return Suspect(bundleID: bundleID, name: name, note: note)
                }
                let lower = name.lowercased()
                for (fragment, note) in suspectNameFragments where lower.contains(fragment) {
                    return Suspect(bundleID: bundleID, name: name, note: note)
                }
                return nil
            }

        var lines: [String] = []
        if running.isEmpty {
            lines.append("No running GUI apps matched known hotkey owners.")
        } else {
            lines.append("Likely owners among running apps:")
            for suspect in running {
                lines.append("  • \(suspect.name) — \(suspect.note)")
            }
        }
        lines.append("")
        lines.append("Not listed anywhere? Check System Settings → Keyboard → Keyboard")
        lines.append("Shortcuts → App Shortcuts, plus any launcher/automation utility.")
        lines.append("Carbon-registered shortcuts (the usual culprit) don't appear in")
        lines.append("System Settings at all, even though they hold the combo.")
        return lines.joined(separator: "\n")
    }
}
