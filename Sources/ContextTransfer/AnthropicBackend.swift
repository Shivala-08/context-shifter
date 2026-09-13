import Foundation

/// Cloud extraction backend — Anthropic Messages API.
/// Requires the user's own API key (Settings).
struct AnthropicBackend: ExtractionBackend {
    let apiKey: String

    static let apiURL = URL(string: "https://api.anthropic.com/v1/messages")!
    static let model = "claude-sonnet-4-6"
    static let maxTokens = 1500

    /// One raw API round-trip; also reused by the Task 4b validation retry.
    private func rawExtract(from conversation: String) async throws -> String {
        guard !apiKey.trimmingCharacters(in: .whitespaces).isEmpty else {
            throw ExtractionError.emptyAPIKey
        }

        var request = URLRequest(url: Self.apiURL)
        request.httpMethod = "POST"
        request.setValue(apiKey, forHTTPHeaderField: "x-api-key")
        request.setValue("2023-06-01", forHTTPHeaderField: "anthropic-version")
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.timeoutInterval = 120

        let body: [String: Any] = [
            "model": Self.model,
            "max_tokens": Self.maxTokens,
            "system": systemPrompt,
            "messages": [
                [
                    "role": "user",
                    "content": "Here is the conversation to extract context from:\n\n\(conversation)",
                ]
            ],
        ]

        do {
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        } catch {
            throw ExtractionError.malformedResponse(reason: "failed to encode request body: \(error.localizedDescription)")
        }

        let (data, response) = try await URLSession.shared.data(for: request)

        if let http = response as? HTTPURLResponse, http.statusCode != 200 {
            let bodyText = String(data: data, encoding: .utf8) ?? ""
            throw ExtractionError.httpStatus(code: http.statusCode, body: bodyText)
        }

        return try ExtractionResponseParsing.anthropicText(from: data)
    }

    func extractContext(from conversation: String) async throws -> String {
        let (card, needsWarning) = try await ContextCardValidation.extractValidated(rawExtract, conversation: conversation)
        if needsWarning { ExtractionWarning.shared.set() }
        return card
    }
}
