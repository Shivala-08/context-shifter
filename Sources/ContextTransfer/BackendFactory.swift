import Foundation

/// Constructs the extraction backend from the user's persisted settings.
/// Kept separate so both the Phase 1 window and the Phase 2 capture flow use
/// the exact same selection logic — the backend is always built fresh so
/// Settings changes take effect on the next call.
enum BackendFactory {
    static func make(backendType: String, anthropicAPIKey: String, ollamaHost: String, ollamaModel: String) -> ExtractionBackend {
        let type = BackendType(rawValue: backendType) ?? .cloud
        switch type {
        case .cloud:
            return AnthropicBackend(apiKey: anthropicAPIKey)
        case .local:
            return OllamaBackend(host: ollamaHost, model: ollamaModel)
        }
    }
}
