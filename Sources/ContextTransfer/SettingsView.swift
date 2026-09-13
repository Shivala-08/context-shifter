import SwiftUI

/// Settings — extraction backend (Phase 1) + quick-capture options (Phase 2).
/// The Anthropic API key lives in the Keychain (Task 4c); all other values
/// persist via @AppStorage/UserDefaults and are read by ContentView and the
/// capture flow to construct the backend per call.
struct SettingsView: View {
    // Strings are stored raw (not as enums) so @AppStorage round-trips cleanly.
    // Default backend is Local (Task 6): fresh install works fully offline
    // with no API key prompt.
    @AppStorage(SettingsKeys.backendType) private var backendTypeRaw: String = BackendType.local.rawValue
    @AppStorage(SettingsKeys.ollamaHost) private var ollamaHost = OllamaBackend.defaultHost
    @AppStorage(SettingsKeys.ollamaModel) private var ollamaModel = OllamaBackend.defaultModel
    @AppStorage(SettingsKeys.hotKey) private var hotKeyRaw: String = ""
    @AppStorage(SettingsKeys.restoreClipboard) private var restoreClipboard = true
    @AppStorage(SettingsKeys.panelPlacement) private var panelPlacementRaw: String = PanelPlacement.nearCursor.rawValue
    @AppStorage(SettingsKeys.panelCorner) private var panelCornerRaw: String = PanelPlacement.Corner.topRight.rawValue
    // TRD 3.3: user-added capture exclusion apps (array as joined string).
    @AppStorage(SettingsKeys.captureExclusions) private var captureExclusionsRaw: String = ""
    // Launch-at-login preference; the system-side registration is the source
    // of truth and is re-checked whenever Settings opens.
    @AppStorage(SettingsKeys.launchAtLogin) private var launchAtLogin = false

    // Task 4c: the API key is never kept in SwiftUI state across launches —
    // it's loaded from / written straight to the Keychain.
    @State private var anthropicAPIKey = ""

    // Ollama model list (fetched from <host>/api/tags).
    @State private var availableModels: [String] = []
    @State private var isFetchingModels = false
    @State private var modelListError: String?

    // Hotkey recorder state.
    @State private var recordedCombo: HotKeyCombo?

    // TRD 3.2: "Test shortcut" collision check.
    @State private var isTestingHotKey = false
    @State private var hotKeyTestResult: HotKeyTestResult?
    @State private var hotKeyTestObserver: NSObjectProtocol?
    @State private var hotKeyTestTimeout: DispatchWorkItem?

    // TRD 3.3: exclusion list editor state.
    @State private var newExclusionBundleID = ""

    private var backendType: BackendType { BackendType(rawValue: backendTypeRaw) ?? .local }
    private var panelPlacement: PanelPlacement { PanelPlacement(rawValue: panelPlacementRaw) ?? .nearCursor }
    private var currentCombo: HotKeyCombo { recordedCombo ?? HotKeyCodec.decode(hotKeyRaw) ?? .default }

    private var captureExclusions: [String] {
        captureExclusionsRaw
            .split(separator: "\n")
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
    }

    var body: some View {
        Form {
            Section("General") {
                Toggle("Launch at login", isOn: $launchAtLogin)
                    .onChange(of: launchAtLogin) { enabled in
                        LaunchAtLogin.setEnabled(enabled)
                    }
                if launchAtLogin && !LaunchAtLogin.isEnabled {
                    Text("Waiting for approval — confirm in System Settings → General → Login Items.")
                        .font(.footnote)
                        .foregroundColor(.secondary)
                    Button("Open Login Items Settings") {
                        if let url = URL(string: "x-apple.systempreferences:com.apple.LoginItems-Settings.extension") {
                            NSWorkspace.shared.open(url)
                        }
                    }
                }
            }

            Section("Extraction backend") {
                Picker("Backend", selection: $backendTypeRaw) {
                    Text(BackendType.cloud.label).tag(BackendType.cloud.rawValue)
                    Text(BackendType.local.label).tag(BackendType.local.rawValue)
                }
                .pickerStyle(.segmented)
                .onChange(of: backendTypeRaw) { newValue in
                    if newValue == BackendType.local.rawValue && availableModels.isEmpty {
                        refreshModels()
                    }
                }

                switch backendType {
                case .cloud:
                    // Task 4c: SecureField bound to Keychain-backed state.
                    SecureField("Anthropic API key", text: $anthropicAPIKey, prompt: Text("sk-ant-…"))
                        .onSubmit(saveAPIKey)
                    Text("Get a key at console.anthropic.com. Stored in your Keychain, sent only to api.anthropic.com.")
                        .font(.footnote)
                        .foregroundColor(.secondary)

                case .local:
                    TextField("Ollama host", text: $ollamaHost, prompt: Text(OllamaBackend.defaultHost))
                        .onSubmit(refreshModels)
                    modelRow
                    if let modelListError {
                        Text(modelListError)
                            .font(.caption)
                            .foregroundColor(.red)
                    }
                    Text("Requires Ollama running locally. No API key needed.")
                        .font(.footnote)
                        .foregroundColor(.secondary)
                }
            }

            Section("Quick capture") {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Capture shortcut")
                    HotKeyRecorder(combo: $recordedCombo)
                        .frame(height: 30)
                    Text("Currently \(HotKeyCodec.displayString(currentCombo)) — select text anywhere, then press it.")
                        .font(.caption)
                        .foregroundColor(.secondary)

                    // TRD 3.2: a global NSEvent monitor doesn't fail loudly
                    // when another app already owns the combo — it just never
                    // fires, which looks like a silent bug. This button makes
                    // the failure visible: press the shortcut immediately
                    // after; no detection within the window means warn.
                    HStack(spacing: 8) {
                        Button {
                            testHotKey()
                        } label: {
                            Text(isTestingHotKey ? "Press the shortcut now…" : "Test shortcut")
                        }
                        .disabled(isTestingHotKey)

                        switch hotKeyTestResult {
                        case .none:
                            EmptyView()
                        case .some(.detected):
                            Label("Shortcut detected — it works.", systemImage: "checkmark.circle.fill")
                                .font(.caption)
                                .foregroundColor(.green)
                        case .some(.notDetected):
                            Label("Not detected — this combo may already be in use by another app; try a different one.", systemImage: "exclamationmark.triangle.fill")
                                .font(.caption)
                                .foregroundColor(.orange)
                        }
                    }
                }

                Toggle("Restore clipboard after capture", isOn: $restoreClipboard)

                Picker("Panel position", selection: $panelPlacementRaw) {
                    Text(PanelPlacement.nearCursor.label).tag(PanelPlacement.nearCursor.rawValue)
                    Text(PanelPlacement.fixedCorner.label).tag(PanelPlacement.fixedCorner.rawValue)
                }
                .pickerStyle(.segmented)

                if panelPlacement == .fixedCorner {
                    Picker("Corner", selection: $panelCornerRaw) {
                        ForEach(PanelPlacement.Corner.allCases) { corner in
                            Text(corner.label).tag(corner.rawValue)
                        }
                    }
                }
            }

            // TRD 3.3: capture is skipped entirely for these bundle IDs.
            Section {
                ForEach(captureExclusions, id: \.self) { bundleID in
                    HStack {
                        Text(bundleID)
                            .font(.system(.caption, design: .monospaced))
                        Spacer()
                        Button {
                            removeExclusion(bundleID)
                        } label: {
                            Image(systemName: "minus.circle")
                        }
                        .buttonStyle(.plain)
                        .foregroundColor(.red)
                        .help("Remove from exclusion list")
                    }
                }

                HStack {
                    TextField("Add bundle identifier (e.g. com.example.app)", text: $newExclusionBundleID)
                        .onSubmit(addExclusion)
                    Button("Add") { addExclusion() }
                        .disabled(trimmedNewExclusion.isEmpty)
                }
            } header: {
                Text("Never capture from")
            } footer: {
                Text("Quick capture is silently skipped in these apps (password managers, banking, …). Built-ins: 1Password, Keychain Access.")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
        }
        .padding(20)
        // minHeight keeps the exclusion editor unclipped even when macOS
        // restores a stale (shorter) saved window frame.
        .frame(minWidth: 480, minHeight: 620)
        .onAppear {
            // Task 4c: pull the key from the Keychain (migrating a legacy
            // UserDefaults value once, then scrubbing it).
            KeychainHelper.migrateFromUserDefaultsIfNeeded()
            anthropicAPIKey = KeychainHelper.load() ?? ""
            // Launch-at-login: system registration is the source of truth.
            launchAtLogin = LaunchAtLogin.isEnabled
            recordedCombo = HotKeyCodec.decode(hotKeyRaw) ?? .default
            if backendType == .local && availableModels.isEmpty {
                refreshModels()
            }
        }
        .onDisappear {
            saveAPIKey()
            stopHotKeyTest()
        }
        .onChange(of: recordedCombo) { combo in
            if let combo {
                hotKeyRaw = HotKeyCodec.encode(combo)
            }
            // New combo: the previous test verdict no longer applies.
            hotKeyTestResult = nil
            stopHotKeyTest()
        }
        .onChange(of: hotKeyRaw) { _ in
            // The persisted combo changed — tell the AppDelegate so the
            // global monitors pick up the new shortcut without a relaunch.
            NotificationCenter.default.post(name: .hotKeySettingChanged, object: nil)
        }
        .onChange(of: ollamaHost) { _ in
            // Host changed — the cached list is stale.
            availableModels = []
            modelListError = nil
        }
    }

    // MARK: - API key (Keychain-backed)

    private func saveAPIKey() {
        let trimmed = anthropicAPIKey.trimmingCharacters(in: .whitespaces)
        if trimmed.isEmpty {
            KeychainHelper.delete()
        } else {
            KeychainHelper.save(trimmed)
        }
    }

    // MARK: - Hotkey collision test (TRD 3.2)

    private enum HotKeyTestResult {
        case detected
        case notDetected
    }

    private func testHotKey() {
        stopHotKeyTest()
        hotKeyTestResult = nil
        isTestingHotKey = true

        let startTime = Date()
        let center = NotificationCenter.default

        // Reuse the app's existing broadcast: the global hotkey handler fires
        // it whenever the current combo is detected anywhere in the session.
        hotKeyTestObserver = center.addObserver(
            forName: .hotKeyDetected, object: nil, queue: .main
        ) { _ in
            // Ignore the press that armed the test itself (0.2s debounce).
            guard isTestingHotKey, Date().timeIntervalSince(startTime) >= 0.2 else { return }
            hotKeyTestResult = .detected
            isTestingHotKey = false
        }

        // No detection within the window → likely owned by another app.
        let timeout = DispatchWorkItem {
            guard isTestingHotKey else { return }
            hotKeyTestResult = .notDetected
            isTestingHotKey = false
        }
        hotKeyTestTimeout = timeout
        DispatchQueue.main.asyncAfter(deadline: .now() + 3.0, execute: timeout)
    }

    private func stopHotKeyTest() {
        isTestingHotKey = false
        if let observer = hotKeyTestObserver {
            NotificationCenter.default.removeObserver(observer)
            hotKeyTestObserver = nil
        }
        hotKeyTestTimeout?.cancel()
        hotKeyTestTimeout = nil
    }

    // MARK: - Exclusion list (TRD 3.3)

    private var trimmedNewExclusion: String {
        newExclusionBundleID.trimmingCharacters(in: .whitespaces)
    }

    private func addExclusion() {
        let id = trimmedNewExclusion
        guard !id.isEmpty else { return }
        var exclusions = captureExclusions
        guard !exclusions.contains(id) else {
            newExclusionBundleID = ""
            return
        }
        exclusions.append(id)
        captureExclusionsRaw = exclusions.joined(separator: "\n")
        newExclusionBundleID = ""
    }

    private func removeExclusion(_ bundleID: String) {
        var exclusions = captureExclusions
        exclusions.removeAll { $0 == bundleID }
        captureExclusionsRaw = exclusions.joined(separator: "\n")
    }

    // MARK: - Ollama model picker

    private var modelRow: some View {
        HStack(spacing: 8) {
            if availableModels.isEmpty {
                TextField("Model", text: $ollamaModel, prompt: Text(OllamaBackend.defaultModel))
            } else {
                Picker("Model", selection: $ollamaModel) {
                    ForEach(availableModels, id: \.self) { model in
                        Text(model).tag(model)
                    }
                    if !availableModels.contains(ollamaModel) {
                        Text(ollamaModel).tag(ollamaModel)
                    }
                }
            }

            Button {
                refreshModels()
            } label: {
                Image(systemName: "arrow.clockwise")
            }
            .disabled(isFetchingModels)
            .help("Reload the model list from Ollama")

            if isFetchingModels {
                ProgressView()
                    .controlSize(.small)
            }
        }
    }

    /// Pulls installed models from `<host>/api/tags`; on failure keeps the
    /// free-text field usable and shows the specific error inline.
    private func refreshModels() {
        guard !isFetchingModels else { return }
        isFetchingModels = true
        modelListError = nil
        let host = ollamaHost
        Task {
            do {
                let models = try await OllamaBackend.fetchAvailableModels(host: host)
                availableModels = models
            } catch {
                modelListError = error.localizedDescription
            }
            isFetchingModels = false
        }
    }
}
