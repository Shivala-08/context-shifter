import Foundation

/// Constructs the extraction backend from the user's persisted settings.
/// Kept separate so both the Phase 1 window and the Phase 2 capture flow use
/// the exact same selection logic — the backend is always built fresh so
/// Settings changes take effect on the next call.
enum BackendFactory {
    static func make(backendType: String, anthropicAPIKey: String, ollamaHost: String, ollamaModel: String) -> ExtractionBackend {
        let type = BackendType(rawValue: backendType) ?? .local
        switch type {
        case .cloud:
            // An unset/empty key can never succeed — degrade to the local
            // model instead of erroring on a misconfiguration.
            if anthropicAPIKey.trimmingCharacters(in: .whitespaces).isEmpty {
                return OllamaBackend(host: ollamaHost, model: ollamaModel)
            }
            return AnthropicBackend(apiKey: anthropicAPIKey)
        case .local:
            return OllamaBackend(host: ollamaHost, model: ollamaModel)
        }
    }
}
