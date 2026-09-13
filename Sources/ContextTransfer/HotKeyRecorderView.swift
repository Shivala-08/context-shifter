import AppKit
import Carbon.HIToolbox
import SwiftUI

/// Click-to-record global hotkey control: a bordered NSView that captures
/// keyDown while focused and normalizes it into a HotKeyCombo.
struct HotKeyRecorder: NSViewRepresentable {
    @Binding var combo: HotKeyCombo?

    func makeNSView(context: Context) -> HotKeyRecordingView {
        let view = HotKeyRecordingView()
        view.onCombo = { [weak view] newCombo in
            view?.show(combo: newCombo)
            combo = newCombo
        }
        return view
    }

    func updateNSView(_ view: HotKeyRecordingView, context: Context) {
        view.show(combo: combo)
    }
}

final class HotKeyRecordingView: NSView {
    var onCombo: ((HotKeyCombo) -> Void)?

    private let label = NSTextField(labelWithString: "")
    private var isRecording = false

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        setup()
    }

    required init?(coder: NSCoder) {
        super.init(coder: coder)
        setup()
    }

    private func setup() {
        wantsLayer = true
        layer?.cornerRadius = 5

        label.alignment = .center
        label.font = NSFont.monospacedSystemFont(ofSize: 13, weight: .medium)
        label.translatesAutoresizingMaskIntoConstraints = false
        addSubview(label)
        NSLayoutConstraint.activate([
            label.centerXAnchor.constraint(equalTo: centerXAnchor),
            label.centerYAnchor.constraint(equalTo: centerYAnchor),
        ])

        setRecording(false)
        show(combo: nil)
    }

    func show(combo: HotKeyCombo?) {
        label.stringValue = combo.map { HotKeyCodec.displayString($0) } ?? "Click, then press a shortcut"
    }

    override var acceptsFirstResponder: Bool { true }

    override func becomeFirstResponder() -> Bool {
        let accepted = super.becomeFirstResponder()
        if accepted { setRecording(true) }
        return accepted
    }

    override func resignFirstResponder() -> Bool {
        setRecording(false)
        return super.resignFirstResponder()
    }

    private func setRecording(_ recording: Bool) {
        isRecording = recording
        layer?.borderWidth = recording ? 2 : 1
        layer?.borderColor = recording
            ? NSColor.controlAccentColor.cgColor
            : NSColor.separatorColor.cgColor
        layer?.backgroundColor = NSColor.textBackgroundColor.cgColor
    }

    override func keyDown(with event: NSEvent) {
        // Require at least one modifier so plain typing can't be captured.
        let relevant = event.modifierFlags.intersection([.command, .shift, .option, .control])
        guard !relevant.isEmpty else {
            NSSound.beep()
            return
        }
        onCombo?(HotKeyCodec.normalized(UInt32(event.keyCode), event.modifierFlags))
    }
}
