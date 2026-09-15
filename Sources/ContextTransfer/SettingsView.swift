import SwiftUI
import Carbon.HIToolbox

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
    @AppStorage(SettingsKeys.copyCaptureTrailOnFailure) private var copyCaptureTrailOnFailure = false
    @AppStorage(SettingsKeys.soundOnCaptureSuccess) private var soundOnCaptureSuccess = false
    @AppStorage(SettingsKeys.soundOnCaptureFailure) private var soundOnCaptureFailure = true
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
    @State private var showKeyboardPicker = false

    // Hotkey ownership check. No countdown-guessing: the system tells us
    // directly whether the combo is free, then we listen for a real press.
    @State private var hotKeyTestResult: HotKeyTestResult?
    @State private var isListeningForPress = false
    @State private var hotKeyTestObserver: NSObjectProtocol?
    @State private var hotKeyListenTimeout: DispatchWorkItem?
    // Inline collision diagnosis (likely owner apps) for a taken combo.
    @State private var collisionReport: String?
    @State private var didCopyCollisionReport = false

    // Full-pipeline self-check results (Run diagnostics button).
    @State private var pipelineReport: PipelineDiagnostics.Report?

    // Accessibility trust banner: global key monitors silently don't exist
    // without the grant, so Settings says so instead of leaving a dead
    // shortcut that "Test shortcut" blames on other apps.
    @State private var accessibilityTrusted = AccessibilityOnboarding.isTrusted()
    @State private var trustPollTimer: Timer?

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

    /// Combos that would collide with everyday text editing / app control if
    /// a global monitor swallowed them. The recorder still accepts them (the
    /// user may genuinely want, say, ⌃V), but Settings shows the warning.
    private static let reservedCombos: [(keyCode: UInt32, modifiers: NSEvent.ModifierFlags, label: String)] = [
        (UInt32(kVK_ANSI_C), .command, "⌘C (copy)"),
        (UInt32(kVK_ANSI_V), .command, "⌘V (paste)"),
        (UInt32(kVK_ANSI_X), .command, "⌘X (cut)"),
        (UInt32(kVK_ANSI_A), .command, "⌘A (select all)"),
        (UInt32(kVK_ANSI_Z), .command, "⌘Z (undo)"),
        (UInt32(kVK_ANSI_W), .command, "⌘W (close window)"),
        (UInt32(kVK_ANSI_Q), .command, "⌘Q (quit)"),
        (UInt32(kVK_Tab), .command, "⌘Tab (app switcher)"),
    ]

    private var reservedCollision: String? {
        guard let combo = recordedCombo else { return nil }
        return Self.reservedCombos.first {
            $0.keyCode == combo.keyCode && UInt($0.modifiers.rawValue) == combo.modifiers
        }?.label
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
                    HStack(spacing: 8) {
                        HotKeyRecorder(combo: $recordedCombo)
                            .frame(height: 30)
                        Button {
                            withAnimation(.easeInOut(duration: 0.2)) {
                                showKeyboardPicker.toggle()
                            }
                        } label: {
                            Label(showKeyboardPicker ? "Hide keyboard" : "Keyboard", systemImage: "keyboard")
                        }
                        .help("Pick the shortcut from an on-screen keyboard")
                        Button("Reset") {
                            recordedCombo = .default
                        }
                        .disabled(recordedCombo == .default)
                        .help("Restore the default ⌘⇧X shortcut")
                    }

                    // Embedded inline ON PURPOSE: a .sheet attached inside a
                    // Settings-scene Form silently never presents on several
                    // macOS versions — the picker would look "added but not
                    // working". Inline embeds always render.
                    if showKeyboardPicker {
                        HotKeyKeyboardPickerView(combo: $recordedCombo, onClose: {
                            withAnimation(.easeInOut(duration: 0.2)) {
                                showKeyboardPicker = false
                            }
                        })
                        .background(
                            RoundedRectangle(cornerRadius: 10)
                                .fill(Color.primary.opacity(0.04))
                        )
                    }
                    Text("Currently \(HotKeyCodec.displayString(currentCombo)) — select text anywhere, then press it.")
                        .font(.caption)
                        .foregroundColor(.secondary)

                    // The shortcut can't work at all without Accessibility:
                    // the global monitors are only installed when trusted.
                    // Show it here — a missing grant is invisible otherwise.
                    if !accessibilityTrusted {
                        VStack(alignment: .leading, spacing: 6) {
                            Label("Accessibility is off — the capture shortcut isn't listening anywhere.", systemImage: "hand.raised.fill")
                                .font(.caption.weight(.medium))
                                .foregroundColor(.red)
                            if TrustMonitor.grantBelongsToDifferentBuild {
                                Text(TrustMonitor.rebuiltBinaryExplanation)
                                    .font(.caption)
                                    .foregroundColor(.orange)
                            }
                            HStack(spacing: 8) {
                                Button("Open Accessibility Settings") {
                                    AccessibilityOnboarding.openAccessibilitySettings()
                                }
                                Text("After granting, this window updates automatically.")
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                            }
                        }
                        .padding(10)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(RoundedRectangle(cornerRadius: 8).fill(Color.red.opacity(0.08)))
                    }

                    // Guard rail: a combo the system itself uses for text
                    // editing would fire capture on every copy/paste.
                    if let collision = reservedCollision {
                        Label("\(collision) is reserved by macOS for text editing — pick a different combination.", systemImage: "exclamationmark.triangle.fill")
                            .font(.caption)
                            .foregroundColor(.orange)
                    }

                    // TRD 3.2, reworked: the old "press and wait 3s" check
                    // auto-showed "Not detected" on timeout — blaming the
                    // combo even when the user simply hadn't pressed it yet.
                    // Now the system itself is asked who owns the combo
                    // (RegisterEventHotKey), so a collision verdict is
                    // instant and provable; the keypress is only a bonus
                    // end-to-end confirmation.
                    HStack(spacing: 8) {
                        Button {
                            testHotKey()
                        } label: {
                            Text(isListeningForPress ? "Press the shortcut now…" : "Test shortcut")
                        }
                        .disabled(isListeningForPress)

                        switch hotKeyTestResult {
                        case .none:
                            EmptyView()
                        case .some(.detected):
                            Label("Shortcut detected — it works.", systemImage: "checkmark.circle.fill")
                                .font(.caption)
                                .foregroundColor(.green)
                        case .some(.takenByOtherApp):
                            Label("Owned by another app — macOS refused registration for this exact combo. Pick a different one.", systemImage: "exclamationmark.triangle.fill")
                                .font(.caption)
                                .foregroundColor(.orange)

                            if let report = collisionReport {
                                VStack(alignment: .leading, spacing: 6) {
                                    Text(report)
                                        .font(.caption)
                                        .foregroundColor(.secondary)
                                        .textSelection(.enabled)
                                    Button {
                                        NSPasteboard.general.clearContents()
                                        NSPasteboard.general.setString(report, forType: .string)
                                        didCopyCollisionReport = true
                                    } label: {
                                        Label(didCopyCollisionReport ? "Copied" : "Copy diagnosis", systemImage: didCopyCollisionReport ? "checkmark" : "doc.on.doc")
                                            .font(.caption)
                                    }
                                }
                                .padding(8)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .background(RoundedRectangle(cornerRadius: 8).fill(Color.orange.opacity(0.08)))
                            }
                        case .some(.probeFailed(let detail)):
                            Label("Couldn't verify (\(detail)) — but the combo is not held by another app. Try pressing the shortcut.", systemImage: "questionmark.circle")
                                .font(.caption)
                                .foregroundColor(.secondary)
                        case .some(.notTrusted):
                            Label("Can't test — Accessibility is off, so the shortcut isn't registered with macOS. Grant it above, then test again.", systemImage: "hand.raised.fill")
                                .font(.caption)
                                .foregroundColor(.orange)
                        }
                    }

                    // One-click full-pipeline self-check: trust → monitors →
                    // combo ownership → target eligibility → clipboard →
                    // backend. Shows exactly where capture is stopped.
                    VStack(alignment: .leading, spacing: 8) {
                        HStack(spacing: 8) {
                            Button {
                                let appDelegate = NSApp.delegate as? AppDelegate
                                pipelineReport = PipelineDiagnostics.run(appDelegate: appDelegate)
                            } label: {
                                Label("Run diagnostics", systemImage: "stethoscope")
                            }
                            if let report = pipelineReport {
                                Text(report.summary)
                                    .font(.caption.weight(.medium))
                                    .foregroundColor(report.checks.contains { !$0.passed && $0.severity == .fail } ? .orange : .green)
                            }
                        }
                        if let report = pipelineReport {
                            VStack(alignment: .leading, spacing: 4) {
                                ForEach(report.checks) { check in
                                    HStack(alignment: .top, spacing: 6) {
                                        Image(systemName: check.symbol)
                                            .foregroundColor(check.passed ? .green : (check.severity == .warn ? .orange : .red))
                                            .font(.caption)
                                        VStack(alignment: .leading, spacing: 1) {
                                            Text(check.name)
                                                .font(.caption.weight(.medium))
                                            Text(check.detail)
                                                .font(.caption)
                                                .foregroundColor(.secondary)
                                        }
                                    }
                                }
                            }
                            .padding(10)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(RoundedRectangle(cornerRadius: 8).fill(Color.primary.opacity(0.04)))
                        }
                    }
                }

                Toggle("Restore clipboard after capture", isOn: $restoreClipboard)

                Toggle(isOn: $copyCaptureTrailOnFailure) {
                    Text("Copy capture trail on failure")
                }
                Text("When a capture finds nothing, the step-by-step diagnostics trail is copied to the clipboard — handy for bug reports.")
                    .font(.caption)
                    .foregroundColor(.secondary)

                Picker("Sound on success", selection: $soundOnCaptureSuccess) {
                    Text("Silent").tag(false)
                    Text("Play a chime").tag(true)
                }
                .pickerStyle(.segmented)
                Picker("Sound on failure", selection: $soundOnCaptureFailure) {
                    Text("Silent").tag(false)
                    Text("Play an alert").tag(true)
                }
                .pickerStyle(.segmented)

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
            accessibilityTrusted = AccessibilityOnboarding.isTrusted()
            if accessibilityTrusted {
                if let appDelegate = NSApp.delegate as? AppDelegate {
                    appDelegate.ensureHotKeyMonitors()
                }
            } else {
                startTrustPolling()
            }
        }
        .onDisappear {
            saveAPIKey()
            stopHotKeyTest()
            stopTrustPolling()
        }
        .onChange(of: recordedCombo) { combo in
            if let combo {
                hotKeyRaw = HotKeyCodec.encode(combo)
            }
            // New combo: the previous test verdict no longer applies.
            hotKeyTestResult = nil
            collisionReport = nil
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
        /// The system confirms no other app holds the combo — the shortcut
        /// works; a capture press was received during the listen window.
        case detected
        /// RegisterEventHotKey refused: another application provably owns
        /// this exact combo system-wide.
        case takenByOtherApp
        /// RegisterEventHotKey refused for a non-collision reason.
        case probeFailed(String)
        /// Trust is missing: the monitors were never installed, so "another
        /// app owns the combo" would be the wrong diagnosis.
        case notTrusted
    }

    @MainActor
    private func testHotKey() {
        stopHotKeyTest()
        hotKeyTestResult = nil

        // Without the Accessibility grant the global monitors were never
        // installed — pressing the shortcut can't reach us no matter what.
        // Say that instead of running a test destined to blame "another app".
        guard accessibilityTrusted else {
            hotKeyTestResult = .notTrusted
            return
        }

        // Make sure the monitors are actually live before judging.
        if let appDelegate = NSApp.delegate as? AppDelegate {
            appDelegate.ensureHotKeyMonitors()
        }

        // Ask the SYSTEM who owns the combo instead of waiting and guessing.
        // This is instant and deterministic: eventHotKeyExistsErr ⇔ another
        // app holds this exact combination.
        switch HotKeyProbe.check(currentCombo) {
        case .takenByOtherApp:
            collisionReport = HotKeyCollisionDiagnostics.report(for: currentCombo)
            hotKeyTestResult = .takenByOtherApp
            return
        case .failed(let status):
            hotKeyTestResult = .probeFailed("system error \(status)")
            return
        case .free:
            collisionReport = nil
            break
        }

        // The combo is free. Listen briefly for a genuine keypress so the
        // user gets positive confirmation end-to-end. Timeouts here are a
        // NEUTRAL reminder, never an error — the ownership question is
        // already answered.
        isListeningForPress = true
        var observer: NSObjectProtocol?
        observer = NotificationCenter.default.addObserver(
            forName: .hotKeyDetected, object: nil, queue: .main
        ) { _ in
            guard self.isListeningForPress else { return }
            self.hotKeyTestResult = .detected
            self.isListeningForPress = false
            if let observer { NotificationCenter.default.removeObserver(observer) }
            self.hotKeyTestObserver = nil
        }
        hotKeyTestObserver = observer

        hotKeyListenTimeout = DispatchWorkItem {
            guard isListeningForPress else { return }
            isListeningForPress = false
        }
        if let timeout = hotKeyListenTimeout {
            DispatchQueue.main.asyncAfter(deadline: .now() + 8.0, execute: timeout)
        }
    }

    private func stopHotKeyTest() {
        isListeningForPress = false
        if let observer = hotKeyTestObserver {
            NotificationCenter.default.removeObserver(observer)
            hotKeyTestObserver = nil
        }
        hotKeyListenTimeout?.cancel()
        hotKeyListenTimeout = nil
    }

    // MARK: - Accessibility trust polling

    /// Polls for the grant while Settings is open so the banner clears (and
    /// the monitors install) the moment the user flips the switch — no
    /// reopen-required, no relaunch.
    private func startTrustPolling() {
        guard trustPollTimer == nil else { return }
        trustPollTimer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { timer in
            guard !AccessibilityOnboarding.isTrusted() else {
                timer.invalidate()
                trustPollTimer = nil
                accessibilityTrusted = true
                // The monitors were never installed while untrusted; the
                // AppDelegate listens for this broadcast and installs them
                // now that the grant has landed.
                NotificationCenter.default.post(name: .hotKeySettingChanged, object: nil)
                return
            }
        }
    }

    private func stopTrustPolling() {
        trustPollTimer?.invalidate()
        trustPollTimer = nil
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
