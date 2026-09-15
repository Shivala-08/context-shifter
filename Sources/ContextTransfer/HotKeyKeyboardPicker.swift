import AppKit
import SwiftUI
import Carbon.HIToolbox

/// On-screen Mac keyboard for picking the capture shortcut: toggle modifiers
/// (⌘ ⌥ ⌃ ⇧), then click a key. Replaces the "click here then press" recorder
/// for people who'd rather point than press — same result, same binding.
struct HotKeyKeyboardPickerView: View {
    @Binding var combo: HotKeyCombo?
    /// Called by Done. The picker is embedded INSIDE the Settings form —
    /// `.sheet` presentation from within a Settings-scene Form silently fails
    /// to appear on several macOS versions, which made this feature look
    /// dead. Inline is unbreakable.
    var onClose: (() -> Void)?

    @State private var modifiers: Set<ModifierToggle> = ModifierToggle.defaultSet
    @State private var selectedKeyCode: UInt32?

    enum ModifierToggle: String, CaseIterable, Identifiable {
        case command, option, control, shift
        var id: String { rawValue }

        var flag: NSEvent.ModifierFlags {
            switch self {
            case .command: return .command
            case .option: return .option
            case .control: return .control
            case .shift: return .shift
            }
        }

        var glyph: String {
            switch self {
            case .command: return "⌘"
            case .option: return "⌥"
            case .control: return "⌃"
            case .shift: return "⇧"
            }
        }

        static let defaultSet: Set<ModifierToggle> = [.command, .shift]
    }

    // Physical layout, top to bottom. (keyCode, legend)
    private let numberRow: [(UInt32, String)] = [
        (50, "`"), (18, "1"), (19, "2"), (20, "3"), (21, "4"), (23, "5"),
        (22, "6"), (26, "7"), (28, "8"), (25, "9"), (29, "0"), (27, "-"), (24, "="),
    ]
    private let topRow: [(UInt32, String)] = [
        (12, "Q"), (13, "W"), (14, "E"), (15, "R"), (17, "T"), (16, "Y"),
        (32, "U"), (34, "I"), (31, "O"), (35, "P"), (33, "["), (30, "]"), (42, "\\"),
    ]
    private let homeRow: [(UInt32, String)] = [
        (0, "A"), (1, "S"), (2, "D"), (3, "F"), (5, "G"), (4, "H"),
        (38, "J"), (40, "K"), (37, "L"), (41, ";"), (39, "'"),
    ]
    private let bottomRow: [(UInt32, String)] = [
        (6, "Z"), (7, "X"), (8, "C"), (9, "V"), (11, "B"), (10, "N"), (46, "M"),
        (43, ","), (47, "."), (44, "/"),
    ]
    private let fRow: [(UInt32, String)] = [
        (122, "F1"), (120, "F2"), (99, "F3"), (118, "F4"), (96, "F5"),
        (97, "F6"), (98, "F7"), (100, "F8"), (101, "F9"),
    ]
    private let arrowKeys: [(UInt32, String)] = [
        (123, "←"), (126, "↑"), (125, "↓"), (124, "→"),
    ]

    var body: some View {
        VStack(spacing: 14) {
            // Live preview + modifier toggles.
            HStack(spacing: 16) {
                Text(previewText)
                    .font(.system(size: 26, weight: .semibold, design: .rounded))
                    .monospacedDigit()
                    .frame(minWidth: 110, alignment: .leading)
                    .foregroundStyle(comboIsValid ? Color.primary : Color.secondary)

                Spacer()

                ForEach(ModifierToggle.allCases) { toggle in
                    modifierButton(toggle)
                }
            }

            // The keyboard itself, roughly physical staggering.
            VStack(spacing: 6) {
                keyRow(numberRow, offset: 0)
                keyRow(topRow, offset: 14)
                keyRow(homeRow, offset: 26)
                HStack(spacing: 6) {
                    Spacer().frame(width: 40)
                    ForEach(bottomRow, id: \.0) { key in
                        keyCap(keyCode: key.0, label: key.1, width: 34)
                    }
                    keyCap(keyCode: 49, label: "space", width: 118)
                    ForEach(arrowKeys, id: \.0) { key in
                        keyCap(keyCode: key.0, label: key.1, width: 30)
                    }
                    Spacer().frame(width: 20)
                }
                keyRow(fRow, offset: 0, compact: true)
            }

            if modifiers.isEmpty {
                Label("Turn on at least one modifier, then click a key.", systemImage: "keyboard")
                    .font(.caption)
                    .foregroundStyle(.orange)
            } else {
                Text("Click a key to set \(previewText) as the capture shortcut.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            HStack {
                Button("Clear") {
                    combo = nil
                    selectedKeyCode = nil
                }
                .foregroundStyle(.secondary)
                Spacer()
                Button("Done") { onClose?() }
                    .keyboardShortcut(.defaultAction)
            }
        }
        .padding(.vertical, 8)
        .frame(maxWidth: .infinity)
        .onAppear(perform: prefillFromCombo)
    }

    private var comboIsValid: Bool { combo != nil }

    @ViewBuilder
    private func modifierButton(_ toggle: ModifierToggle) -> some View {
        let isOn = modifiers.contains(toggle)
        Button {
            if isOn {
                modifiers.remove(toggle)
            } else {
                modifiers.insert(toggle)
            }
        } label: {
            Text(toggle.glyph)
                .font(.system(size: 15, weight: .medium))
                .frame(width: 34, height: 30)
        }
        .buttonStyle(.plain)
        .background(modifierBackground(isOn: isOn))
        .foregroundStyle(isOn ? Color.white : Color.primary)
        .overlay(modifierBorder)
        .help("Toggle \(toggle.rawValue) modifier")
    }

    private func modifierBackground(isOn: Bool) -> some View {
        RoundedRectangle(cornerRadius: 6)
            .fill(isOn ? Color.accentColor : Color.primary.opacity(0.06))
    }

    private var modifierBorder: some View {
        RoundedRectangle(cornerRadius: 6)
            .strokeBorder(Color.primary.opacity(0.12))
    }
    private var previewText: String {
        let mods = ModifierToggle.allCases
            .filter { modifiers.contains($0) }
            .map(\.glyph)
            .joined()
        let key = selectedKeyCode.map { HotKeyCodec.keyName($0) } ?? "…"
        return mods + key
    }

    private func prefillFromCombo() {
        guard let existing = combo else { return }
        var set = Set<ModifierToggle>()
        for toggle in ModifierToggle.allCases where NSEvent.ModifierFlags(rawValue: UInt(existing.modifiers)).contains(toggle.flag) {
            set.insert(toggle)
        }
        modifiers = set
        selectedKeyCode = existing.keyCode
    }

    private func keyRow(_ keys: [(UInt32, String)], offset: CGFloat, compact: Bool = false) -> some View {
        HStack(spacing: 6) {
            Spacer().frame(width: offset)
            ForEach(keys, id: \.0) { key in
                keyCap(keyCode: key.0, label: key.1, width: compact ? 28 : 34, compact: compact)
            }
            Spacer()
        }
    }

    private func keyCap(keyCode: UInt32, label: String, width: CGFloat, compact: Bool = false) -> some View {
        let isSelected = selectedKeyCode == keyCode && !modifiers.isEmpty
        return Button {
            guard !modifiers.isEmpty else {
                NSSound.beep()
                return
            }
            selectedKeyCode = keyCode
            var flags: NSEvent.ModifierFlags = []
            for toggle in modifiers { flags.insert(toggle.flag) }
            combo = HotKeyCodec.normalized(keyCode, flags)
        } label: {
            Text(label)
                .font(compact ? .system(size: 10, weight: .medium) : .system(size: 13, weight: .medium))
                .lineLimit(1)
                .minimumScaleFactor(0.6)
                .frame(width: width, height: compact ? 22 : 30)
        }
        .buttonStyle(.plain)
        .background(
            RoundedRectangle(cornerRadius: 5)
                .fill(isSelected ? Color.accentColor : Color.primary.opacity(0.05))
                .shadow(color: .black.opacity(isSelected ? 0 : 0.15), radius: 1, y: 1)
        )
        .foregroundStyle(isSelected ? Color.white : Color.primary)
        .overlay(
            RoundedRectangle(cornerRadius: 5)
                .strokeBorder(Color.primary.opacity(0.12))
        )
    }
}
