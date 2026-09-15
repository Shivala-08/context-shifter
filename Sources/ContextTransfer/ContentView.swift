import SwiftUI
import AppKit

/// Persisted settings keys shared between ContentView, SettingsView, and the
/// Phase 2 capture flow.
enum SettingsKeys {
    static let backendType = "backendType"
    static let anthropicAPIKey = "anthropicAPIKey"
    static let ollamaHost = "ollamaHost"
    static let ollamaModel = "ollamaModel"
    /// How aggressively to compress the conversation into the card:
    /// CompressionLevel raw value (full / balanced / minimal).
    static let compressionLevel = "compressionLevel"
    static let hotKey = "hotKey"
    static let restoreClipboard = "restoreClipboard"
    static let panelPlacement = "panelPlacement"
    static let panelCorner = "panelCorner"
    /// TRD 3.3: user-added capture exclusion bundle IDs (one per line).
    static let captureExclusions = "captureExclusions"
    /// Copy the capture diagnostics trail to the clipboard whenever a capture
    /// fails, so it's immediately pasteable in a bug report.
    static let copyCaptureTrailOnFailure = "copyCaptureTrailOnFailure"
    /// Play a sound when a capture+extraction succeeds (default off).
    static let soundOnCaptureSuccess = "soundOnCaptureSuccess"
    /// Play a sound when a capture or extraction fails (default on).
    static let soundOnCaptureFailure = "soundOnCaptureFailure"
    /// Launch-at-login preference (mirror; system SMAppService state wins on
    /// conflict, resolved whenever Settings opens).
    static let launchAtLogin = "launchAtLogin"
}

/// Which extraction backend is selected in Settings.
extension Notification.Name {
    /// Posted when the user re-records the capture shortcut in Settings so the
    /// AppDelegate can update the live global-hotkey monitors immediately.
    static let hotKeySettingChanged = Notification.Name("contextTransferHotKeySettingChanged")

    /// Posted by the hotkey handler whenever the capture shortcut is detected
    /// anywhere — feeds Settings' "Test shortcut" collision check (TRD 3.2).
    static let hotKeyDetected = Notification.Name("contextTransferHotKeyDetected")
}

enum BackendType: String, CaseIterable, Identifiable {
    case cloud
    case local

    var id: String { rawValue }

    var label: String {
        switch self {
        case .cloud: return "Cloud (Anthropic)"
        case .local: return "Local (Ollama)"
        }
    }
}

/// Task 5 — paste-in / extract / copy-out UI (Phase 1 window).
struct ContentView: View {
    // Persisted settings; the backend is constructed fresh per extraction so
    // Settings changes take effect on the next call (Task 7).
    // Default backend is Local (Task 6): a fresh install works fully offline
    // with no API key prompt.
    @AppStorage(SettingsKeys.backendType) private var backendTypeRaw: String = BackendType.local.rawValue
    @AppStorage(SettingsKeys.ollamaHost) private var ollamaHost = OllamaBackend.defaultHost
    @AppStorage(SettingsKeys.ollamaModel) private var ollamaModel = OllamaBackend.defaultModel
    // Compression level (Full/Balanced/Minimal); re-read per extraction so a
    // Settings change applies to the next run without reopening the window.
    @AppStorage(SettingsKeys.compressionLevel) private var compressionLevelRaw: String = CompressionLevel.balanced.rawValue

    @State private var inputText = ""
    @State private var outputText = ""
    @State private var errorMessage: String?
    @State private var formatWarning: String?
    /// Compression accounting for the last extraction (original vs. card).
    @State private var compressionStats: CompressionStats?
    @State private var isLoading = false
    @State private var showSettings = false
    @State private var copied = false

    private var backendType: BackendType { BackendType(rawValue: backendTypeRaw) ?? .local }

    /// Task 4: warn before sending when the local model's context window
    /// would silently truncate the pasted conversation (~chars/4 estimate).
    private var tokenEstimateWarning: String? {
        guard backendType == .local,
              OllamaBackend.mayExceedContextWindow(inputText)
        else { return nil }
        let estimate = OllamaBackend.estimatedTokenCount(of: inputText)
        return "This conversation is long (~\(estimate) tokens) and may exceed the local model's context window (\(OllamaBackend.numCtx)); it could be truncated."
    }

    /// Live size estimate for the pasted conversation (~4 chars/token — same
    /// heuristic as the context-window warning), shown before extraction so
    /// the input size is legible against the card's reported reduction stats.
    private var liveTokenEstimate: String? {
        guard !inputText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
        let tokens = CompressionStats.estimateTokens(of: inputText)
        return "~\(CompressionStats.compactTokenCount(tokens)) tokens"
    }

    var body: some View {
        HSplitView {
            inputPane
                .frame(minWidth: 380, maxWidth: .infinity, maxHeight: .infinity)

            outputPane
                .frame(minWidth: 420, maxWidth: .infinity, maxHeight: .infinity)
        }
        .padding(12)
        .sheet(isPresented: $showSettings) {
            SettingsView()
        }
    }

    // MARK: - Left pane: input

    private var inputPane: some View {
        VStack(spacing: 8) {
            TextEditor(text: $inputText)
                .font(.system(.body, design: .monospaced))
                .overlay(alignment: .topLeading) {
                    if inputText.isEmpty {
                        Text("Paste a conversation here…")
                            .foregroundColor(.secondary)
                            .padding(.top, 8)
                            .padding(.leading, 5)
                            .allowsHitTesting(false)
                    }
                }
                // Live token estimate, overlaid (not stacked) so the layout
                // never shifts as the user types; non-hittable so it can't
                // steal clicks meant for the editor.
                .overlay(alignment: .bottomTrailing) {
                    if let liveTokenEstimate {
                        Text(liveTokenEstimate)
                            .font(.caption2)
                            .foregroundColor(.secondary)
                            .monospacedDigit()
                            .padding(6)
                            .allowsHitTesting(false)
                    }
                }
                .overlay(
                    RoundedRectangle(cornerRadius: 6)
                        .stroke(Color(nsColor: .separatorColor))
                )

            HStack(spacing: 8) {
                Button {
                    extract()
                } label: {
                    Label("Extract Context", systemImage: "sparkles")
                }
                .keyboardShortcut(.return, modifiers: .command)
                .disabled(isLoading || inputText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                .help("Extract a context card from the pasted conversation (⌘↩)")

                if isLoading {
                    ProgressView()
                        .controlSize(.small)
                    // Cold-start hint (Task 5): Ollama loads the model into
                    // memory on first request after idle; without this hint a
                    // slow first run is indistinguishable from a hang.
                    if backendType == .local {
                        Text("First run may take longer while the model loads…")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                }

                Spacer()

                Picker("Compression", selection: $compressionLevelRaw) {
                    ForEach(CompressionLevel.allCases) { level in
                        Text(level.label).tag(level.rawValue)
                    }
                }
                .pickerStyle(.segmented)
                .fixedSize()
                .help("How much of the conversation survives into the context card")

                Button("Clear") {
                    inputText = ""
                    outputText = ""
                    errorMessage = nil
                    formatWarning = nil
                    compressionStats = nil
                }
                .disabled(isLoading)

                Button {
                    showSettings = true
                } label: {
                    Image(systemName: "gearshape")
                }
                .help("Settings")
            }
        }
    }

    // MARK: - Right pane: output

    private var outputPane: some View {
        VStack(spacing: 8) {
            HStack {
                Text("Context Card")
                    .font(.headline)
                if let stats = compressionStats, !stats.summary.isEmpty {
                    // e.g. "18.4k → 2.1k tokens · 89% smaller"
                    Text(stats.summary)
                        .font(.caption)
                        .foregroundColor(.secondary)
                        .monospacedDigit()
                        .help("Estimated with a ~4 characters-per-token heuristic")
                }
                Spacer()
                Button {
                    copyOutput()
                } label: {
                    Label(copied ? "Copied" : "Copy", systemImage: copied ? "checkmark" : "doc.on.doc")
                }
                .disabled(outputText.isEmpty || isLoading)
                .help("Copy the context card to the clipboard")
            }

            if let formatWarning {
                Label {
                    Text(formatWarning)
                        .textSelection(.enabled)
                } icon: {
                    Image(systemName: "exclamationmark.triangle.fill")
                }
                .foregroundColor(.orange)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(8)
                .background(Color.orange.opacity(0.08))
                .cornerRadius(6)
            }

            ScrollView {
                Group {
                    if outputText.isEmpty {
                        Text("Extracted context card will appear here.")
                            .foregroundColor(.secondary)
                    } else {
                        Text(outputText)
                            .textSelection(.enabled)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(8)
            }
            .background(Color(nsColor: .textBackgroundColor))
            .overlay(
                RoundedRectangle(cornerRadius: 6)
                    .stroke(Color(nsColor: .separatorColor))
            )

            if let errorMessage {
                Label {
                    Text(errorMessage)
                        .textSelection(.enabled)
                } icon: {
                    Image(systemName: "exclamationmark.triangle.fill")
                }
                .foregroundColor(.red)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(8)
                .background(Color.red.opacity(0.08))
                .cornerRadius(6)
            }

            if let tokenEstimateWarning {
                Label {
                    Text(tokenEstimateWarning)
                        .textSelection(.enabled)
                } icon: {
                    Image(systemName: "exclamationmark.triangle")
                }
                .foregroundColor(.orange)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(8)
                .background(Color.orange.opacity(0.08))
                .cornerRadius(6)
            }
        }
    }

    // MARK: - Actions

    private func extract() {
        let conversation = inputText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !conversation.isEmpty else {
            errorMessage = ExtractionError.emptyInput.localizedDescription
            return
        }

        isLoading = true
        errorMessage = nil
        formatWarning = nil
        outputText = ""
        compressionStats = nil

        let backend = BackendFactory.make(
            backendType: backendTypeRaw,
            // Task 4c: the key lives in the Keychain, not UserDefaults.
            anthropicAPIKey: KeychainHelper.load() ?? "",
            ollamaHost: ollamaHost,
            ollamaModel: ollamaModel
        )

        Task { @MainActor in
            do {
                let level = CompressionLevel(rawValue: compressionLevelRaw) ?? .balanced
                let (card, stats) = try await backend.extractContext(from: conversation, level: level)
                // Task 4b: malformed output is shown but flagged, never
                // silently presented as if it were fine.
                formatWarning = ExtractionWarning.shared.consume()
                outputText = card
                compressionStats = stats
            } catch {
                _ = ExtractionWarning.shared.consume() // reset for the next run
                errorMessage = error.localizedDescription
            }
            isLoading = false
        }
    }

    private func copyOutput() {
        let pasteboard = NSPasteboard.general
        pasteboard.clearContents()
        pasteboard.setString(outputText, forType: .string)
        copied = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) {
            copied = false
        }
    }
}
