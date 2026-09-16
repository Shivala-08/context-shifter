import Foundation

/// Local extraction backend — Ollama running on the user's Mac.
/// No API key; requires Ollama installed and running with the model pulled.
struct OllamaBackend: ExtractionBackend {
    var host: String = "http://localhost:11434"
    var model: String = "qwen3:8b"

    /// Explicit context window (Task 4): Ollama's default (often 2K–4K tokens
    /// depending on model) silently truncates long pasted conversations — the
    /// model just never sees the end of the input, with no error.
    static let numCtx = 8192

    /// Latency: keep the model resident between captures. Without this,
    /// Ollama unloads after ~5 min idle and the next capture pays the full
    /// cold-load (seconds on big models). "10m" covers a work session
    /// without pinning RAM forever.
    static let keepAlive = "10m"

    /// Latency + cost bound: cards are short. Without a cap, a rambly model
    /// (or one stuck emitting reasoning) generates until it feels done.
    static let maxOutputTokens = 1024

    /// Task 4: warn before sending when the input plausibly exceeds the
    /// context window (~chars/4 heuristic). Beyond this, input is likely to be
    /// truncated; better the user knows than a silently clipped card.
    static let tokenEstimateWarningThreshold = 6144

    /// Pulls the list of installed models from `<host>/api/tags` for the
    /// Settings model picker.
    static func fetchAvailableModels(host: String) async throws -> [String] {
        let trimmed = normalizedHost(host)
        guard let url = URL(string: "\(trimmed)/api/tags") else {
            throw ExtractionError.malformedResponse(reason: "invalid Ollama host: \(host)")
        }

        var request = URLRequest(url: url)
        request.timeoutInterval = 5

        let data: Data
        do {
            (data, _) = try await URLSession.shared.data(for: request)
        } catch {
            throw ExtractionError.ollamaUnreachable(host: trimmed, model: "—", underlying: error.localizedDescription)
        }

        guard let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let models = root["models"] as? [[String: Any]]
        else {
            throw ExtractionError.malformedResponse(reason: "unexpected /api/tags response")
        }

        let names = models.compactMap { $0["name"] as? String }.sorted()
        guard !names.isEmpty else {
            throw ExtractionError.malformedResponse(reason: "Ollama is reachable but no models are pulled (`ollama pull qwen3:8b`)")
        }
        return names
    }

    static func normalizedHost(_ host: String) -> String {
        var trimmed = host.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { trimmed = defaultHost }
        while trimmed.hasSuffix("/") { trimmed.removeLast() }
        return trimmed
    }

    /// Rough token estimate so the UI can warn before a silently truncated
    /// request is sent (~4 characters per token for English-ish text).
    static func estimatedTokenCount(of text: String) -> Int {
        text.count / 4
    }

    /// True when the conversation plausibly exceeds `numCtx`.
    static func mayExceedContextWindow(_ conversation: String) -> Bool {
        estimatedTokenCount(of: conversation) > tokenEstimateWarningThreshold
    }

    /// One raw API round-trip; also reused by the Task 4b validation retry.
    private func rawExtract(from conversation: String, level: CompressionLevel) async throws -> String {
        // Ollama's /api/generate has no separate system-prompt field the way the
        // Anthropic API does — concatenate system prompt + conversation into one
        // prompt string.
        let prompt = """
        \(systemPrompt(for: level))

        Here is the conversation to extract from:

        \(conversation)
        """

        let trimmedHost = Self.normalizedHost(host)

        guard let url = URL(string: "\(trimmedHost)/api/generate") else {
            throw ExtractionError.malformedResponse(reason: "invalid Ollama host: \(host)")
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.timeoutInterval = 300 // local 8B models can be slow

        let body: [String: Any] = [
            "model": model,
            "prompt": prompt,
            "stream": false,
            // Keep the model loaded so back-to-back captures skip cold-start.
            "keep_alive": Self.keepAlive,
            // Thinking models (qwen3…) default to emitting <think> blocks we
            // strip anyway — skip generating them at all. Older Ollama
            // servers ignore this field, so it's safe to always send.
            "think": false,
            "options": [
                "num_ctx": Self.numCtx,
                // Cap follows the compression level so Minimal actually
                // produces a smaller card, not just a differently-worded one.
                "num_predict": level.maxOutputTokens,
            ],
        ]

        do {
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        } catch {
            throw ExtractionError.malformedResponse(reason: "failed to encode request body: \(error.localizedDescription)")
        }

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await URLSession.shared.data(for: request)
        } catch {
            throw ExtractionError.ollamaUnreachable(
                host: trimmedHost,
                model: model,
                underlying: error.localizedDescription
            )
        }

        let status = (response as? HTTPURLResponse)?.statusCode ?? 200
        if status != 200 {
            let bodyText = String(data: data, encoding: .utf8) ?? ""
            // Task 4: OOM on model load has a different fix than
            // connection trouble — surface it specifically, never as the
            // generic "couldn't reach Ollama" message.
            if status == 500, bodyText.lowercased().contains("memory") || bodyText.lowercased().contains("allocat") {
                throw ExtractionError.ollamaOutOfMemory
            }
            throw ExtractionError.ollamaStatus(code: status, body: bodyText)
        }

        return try ExtractionResponseParsing.ollamaText(from: data)
    }

    func extractContext(
        from conversation: String,
        level: CompressionLevel
    ) async throws -> (card: String, stats: CompressionStats) {
        let (card, needsWarning) = try await ContextCardValidation.extractValidated(
            { try await self.rawExtract(from: $0, level: level) },
            conversation: conversation
        )
        if needsWarning { ExtractionWarning.shared.set() }
        let stats = CompressionStats(original: conversation, compressed: card)
        return (card, stats)
    }
}

extension OllamaBackend {
    static let defaultHost = "http://localhost:11434"
    static let defaultModel = "qwen3:8b"

    /// Fires a 1-token generate at launch so the model is loaded into memory
    /// before the user's first capture — turns the first capture's cold-load
    /// into a warm call. Silent no-op when Ollama isn't running or the cloud
    /// backend is configured.
    static func warmUpInBackground(defaults: UserDefaults = .standard) {
        let type = BackendType(rawValue: defaults.string(forKey: SettingsKeys.backendType) ?? "") ?? .local
        if type == .cloud,
           !(KeychainHelper.load() ?? "").trimmingCharacters(in: .whitespaces).isEmpty {
            return // cloud configured and usable — no need to load a local model
        }

        let backend = OllamaBackend(
            host: defaults.string(forKey: SettingsKeys.ollamaHost) ?? defaultHost,
            model: defaults.string(forKey: SettingsKeys.ollamaModel) ?? defaultModel
        )

        Task.detached(priority: .utility) {
            await backend.warmUp()
        }
    }

    /// One minimal generate: loads the model and leaves it resident
    /// (`keep_alive`). Fails silently — warm-up is best-effort.
    private func warmUp() async {
        guard let url = URL(string: "\(Self.normalizedHost(host))/api/generate") else { return }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.timeoutInterval = 120 // model load can take a while
        let body: [String: Any] = [
            "model": model,
            "prompt": "",
            "stream": false,
            "keep_alive": Self.keepAlive,
            "options": ["num_predict": 1],
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: body) else { return }
        request.httpBody = data
        _ = try? await URLSession.shared.data(for: request)
    }
}
