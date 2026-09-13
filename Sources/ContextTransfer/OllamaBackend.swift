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
    private func rawExtract(from conversation: String) async throws -> String {
        // Ollama's /api/generate has no separate system-prompt field the way the
        // Anthropic API does — concatenate system prompt + conversation into one
        // prompt string.
        let prompt = """
        \(systemPrompt)

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
            "options": ["num_ctx": Self.numCtx],
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

    func extractContext(from conversation: String) async throws -> String {
        let (card, needsWarning) = try await ContextCardValidation.extractValidated(rawExtract, conversation: conversation)
        if needsWarning { ExtractionWarning.shared.set() }
        return card
    }
}

extension OllamaBackend {
    static let defaultHost = "http://localhost:11434"
    static let defaultModel = "qwen3:8b"
}
