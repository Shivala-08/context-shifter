import SwiftUI

/// User preference for where the floating panel appears.
enum PanelPlacement: String, CaseIterable, Identifiable {
    case nearCursor
    case fixedCorner

    var id: String { rawValue }

    var label: String {
        switch self {
        case .nearCursor: return "Near cursor"
        case .fixedCorner: return "Fixed corner"
        }
    }

    enum Corner: String, CaseIterable, Identifiable {
        case topRight, bottomRight, topLeft, bottomLeft
        var id: String { rawValue }

        var label: String {
            switch self {
            case .topRight: return "Top right"
            case .bottomRight: return "Bottom right"
            case .topLeft: return "Top left"
            case .bottomLeft: return "Bottom left"
            }
        }
    }
}

/// SwiftUI contents of the floating panel: spinner while extracting, then the
/// card (or the error). Mirrors the Phase 1 output styling.
struct PanelContentView: View {
    let state: FloatingPanelController.State
    let onCopy: () -> Void
    let onClose: () -> Void

    @State private var copied = false

    /// The extracted card, when the state carries one (success or needsReview).
    private var cardText: String? {
        switch state {
        case .success(let card): return card
        case .needsReview(let card, _): return card
        case .loading, .failure: return nil
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                switch state {
                case .loading:
                    ProgressView()
                        .controlSize(.small)
                    Text("Extracting context…")
                        .font(.headline)
                case .success:
                    Image(systemName: "sparkles")
                        .foregroundStyle(.blue)
                    Text("Context Card")
                        .font(.headline)
                case .needsReview:
                    Image(systemName: "sparkles")
                        .foregroundStyle(.orange)
                    Text("Review before using")
                        .font(.headline)
                case .failure:
                    Image(systemName: "exclamationmark.triangle.fill")
                        .foregroundStyle(.red)
                    Text("Capture failed")
                        .font(.headline)
                }

                Spacer()

                if cardText != nil {
                    Button {
                        copyCard()
                    } label: {
                        Label(copied ? "Copied" : "Copy", systemImage: copied ? "checkmark" : "doc.on.doc")
                            .labelStyle(.titleAndIcon)
                    }
                    .controlSize(.small)
                    .keyboardShortcut(.defaultAction)
                }

                Button {
                    onClose()
                } label: {
                    Image(systemName: "xmark")
                }
                .controlSize(.small)
                .buttonStyle(.plain)
                .foregroundStyle(.secondary)
                .help("Dismiss (esc)")
            }

            switch state {
            case .loading:
                Text("Talking to \(backendLabel())…")
                    .font(.caption)
                    .foregroundStyle(.secondary)

            case .success(let card):
                ScrollView {
                    Text(card)
                        .textSelection(.enabled)
                        .font(.system(.caption, design: .monospaced))
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .frame(maxHeight: 260)

            case .needsReview(_, let warning):
                // The one thing the user must not miss: the model didn't
                // follow the expected format, so sections/links may be wrong.
                Text(warning)
                    .font(.caption)
                    .foregroundStyle(.orange)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(8)
                    .background(Color.orange.opacity(0.12))
                    .cornerRadius(6)

                ScrollView {
                    Text(cardText ?? "")
                        .textSelection(.enabled)
                        .font(.system(.caption, design: .monospaced))
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .frame(maxHeight: 260)

            case .failure(let message):
                Text(message)
                    .font(.caption)
                    .foregroundStyle(.red)
                    .textSelection(.enabled)
            }
        }
        .padding(12)
        .frame(width: 360)
        .background(
            RoundedRectangle(cornerRadius: 10)
                .fill(.background)
                .shadow(radius: 8, y: 2)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 10)
                .strokeBorder(Color.primary.opacity(0.1))
        )
    }

    private func copyCard() {
        guard let card = cardText else { return }
        let pasteboard = NSPasteboard.general
        pasteboard.clearContents()
        pasteboard.setString(card, forType: .string)
        copied = true
        onCopy()
    }

    private func backendLabel() -> String {
        let type = BackendType(rawValue: UserDefaults.standard.string(forKey: SettingsKeys.backendType) ?? "") ?? .cloud
        return type.label
    }
}
