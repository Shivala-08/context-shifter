import Foundation

/// Common interface for both extraction backends so the rest of the app is
/// backend-agnostic (cloud Anthropic vs. local Ollama).
protocol ExtractionBackend {
    /// Extracts a structured context card (markdown) from a raw conversation.
    func extractContext(from conversation: String) async throws -> String
}

/// Shared system prompt: both backends receive the exact same instructions so
/// their output shape is interchangeable.
let systemPrompt = """
You extract a portable "context card" from an LLM/app conversation so work can \
resume in a different session. Output ONLY a markdown block with these exact \
sections, in this order, using bullet points, with no preamble and no closing remarks:

## Goal
## Key Decisions
## Constraints & Preferences
## Current State
## Resources & Links
## Open Questions

Rules:
- Write each section as concise bullet points capturing the substance.
- If a section has nothing to report, write exactly: None noted.
- Resources & Links must be copied VERBATIM, never paraphrased or summarized. Any URL, \
file path, exact filename, arxiv ID, or similar concrete reference in the source \
conversation goes there exactly as written. This is the one section where losing \
precision is worse than losing brevity — a model reading the card later can \
reconstruct a paraphrased decision, but it cannot reconstruct a dropped or altered \
link; it will guess, and a guessed link is worse than no link.
- Keep it tight — the card is meant to be pasted as a first message in a new \
session, not read as a report.
- Do not add any other sections, headings, or commentary.
"""

/// Task 4b — non-thread-safe-ish flag raised by a backend when the returned
/// card failed shape validation even after the retry. Consumed and reset by
/// the UI right after the extraction call resolves, then prepended above the
/// card so a malformed result is never shown silently.
final class ExtractionWarning {
    static let shared = ExtractionWarning()
    private var isSet = false
    private init() {}

    func set() { isSet = true }

    /// Returns and clears. All UI access happens on the main thread.
    @MainActor
    func consume() -> String? {
        defer { isSet = false }
        return isSet
            ? "⚠️ This card may be missing sections — the model didn't follow the expected format. Review before using."
            : nil
    }
}

/// Headers every context card must contain (Task 4b validation + retry).
let requiredCardHeaders = [
    "Captured on:",
    "## Goal",
    "## Key Decisions",
    "## Constraints & Preferences",
    "## Current State",
    "## Resources & Links",
    "## Open Questions",
]

/// Task 4b — validate the returned card shape. Small local models commonly
/// drop headers, rename sections, or add a conversational preamble.
func validateContextCard(_ text: String) -> Bool {
    requiredCardHeaders.allSatisfy { text.contains($0) }
}

/// Task 4b — follow-up instruction appended on the single validation retry.
let cardFormatRetryInstruction = """
Your previous output was missing required section(s). Output ONLY the markdown \
card with all required headers, exactly as specified, with no other text.
"""

/// Errors surfaced to the UI. Each case maps to a specific, actionable message
/// so failures are never silent or generic (acceptance checklist requirement).
enum ExtractionError: LocalizedError {
    case emptyAPIKey
    case emptyInput
    case httpStatus(code: Int, body: String)
    case noTextContent
    case malformedResponse(reason: String)
    case ollamaUnreachable(host: String, model: String, underlying: String)
    case ollamaStatus(code: Int, body: String)
    case ollamaOutOfMemory

    var errorDescription: String? {
        switch self {
        case .emptyAPIKey:
            return "No Anthropic API key set. Open Settings and paste your key (console.anthropic.com)."
        case .emptyInput:
            return "Nothing to extract — paste a conversation first."
        case .httpStatus(let code, let body):
            let snippet = body.prefix(300)
            return "Anthropic API returned HTTP \(code). \(snippet.isEmpty ? "(no response body)" : "Response: \(snippet)")"
        case .noTextContent:
            return "Anthropic API responded but contained no text content."
        case .malformedResponse(let reason):
            return "Unexpected response format: \(reason)"
        case .ollamaUnreachable(let host, let model, let underlying):
            return "Couldn't reach Ollama at \(host). Run `ollama serve` and make sure the model is pulled (`ollama pull \(model)`). (\(underlying))"
        case .ollamaStatus(let code, let body):
            let snippet = body.prefix(300)
            return "Ollama returned HTTP \(code). \(snippet.isEmpty ? "(no response body)" : "Response: \(snippet)")"
        case .ollamaOutOfMemory:
            return "Ollama ran out of memory loading this model. Try a smaller model or close other apps."
        }
    }
}

// MARK: - Shared validation retry (Task 4b)

enum ContextCardValidation {
    /// The capture date is appended CLIENT-SIDE, never requested from the
    /// model: small local models reliably drop it (observed with llama3.2:3b),
    /// which failed shape validation, forced a pointless full retry, and
    /// dumped a good card into "Review before using". A date we stamp
    /// ourselves is deterministic and free.
    static func normalizeCard(_ text: String) -> String {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.lowercased().contains("captured on:") else { return trimmed }
        let stamp = Self.cardDateFormatter.string(from: Date())
        return "Captured on: \(stamp)\n\n\(trimmed)"
    }

    static let cardDateFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        f.locale = Locale(identifier: "en_US_POSIX")
        return f
    }()

    /// Wraps a raw backend call with the Task 4b flow: on a malformed card,
    /// retry once with the corrective instruction appended. Returns the card
    /// plus a warning to surface in the UI when the retry also failed shape.
    static func extractValidated(
        _ raw: @escaping (String) async throws -> String,
        conversation: String
    ) async throws -> (card: String, needsFormatWarning: Bool) {
        let first = normalizeCard(try await raw(conversation))
        if validateContextCard(first) { return (first, false) }

        let retryPrompt = """
        \(conversation)

        \(cardFormatRetryInstruction)
        """
        let second = normalizeCard(try await raw(retryPrompt))
        if validateContextCard(second) { return (second, false) }
        return (second, true)
    }
}

// MARK: - Shared response parsing helpers

enum ExtractionResponseParsing {
    /// Joins Anthropic `content[].text` entries into a single string.
    /// Throws `.noTextContent` / `.malformedResponse` if nothing usable is found.
    static func anthropicText(from data: Data) throws -> String {
        guard let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw ExtractionError.malformedResponse(reason: "response is not a JSON object")
        }

        if let errorInfo = root["error"] as? [String: Any] {
            let message = (errorInfo["message"] as? String) ?? "unknown API error"
            throw ExtractionError.malformedResponse(reason: "Anthropic error: \(message)")
        }

        guard let content = root["content"] as? [[String: Any]] else {
            throw ExtractionError.malformedResponse(reason: "missing `content` array")
        }

        let texts = content.compactMap { block -> String? in
            guard let type = block["type"] as? String, type == "text" else { return nil }
            return block["text"] as? String
        }

        let joined = texts.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
            .joined(separator: "\n")

        guard !joined.isEmpty else { throw ExtractionError.noTextContent }
        return joined
    }

    /// Reads Ollama's plain-string `response` field and returns it trimmed.
    static func ollamaText(from data: Data) throws -> String {
        guard let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw ExtractionError.malformedResponse(reason: "response is not a JSON object")
        }

        if let error = root["error"] as? String {
            throw ExtractionError.malformedResponse(reason: "Ollama error: \(error)")
        }

        guard let text = root["response"] as? String else {
            throw ExtractionError.malformedResponse(reason: "missing `response` string field")
        }

        // Some local models (e.g. qwen3) intermittently emit reasoning blocks;
        // strip them so they never leak into the card.
        let stripped = text.replacingOccurrences(
            of: "(?s)<think>.*?</think>\\s*",
            with: "",
            options: .regularExpression
        )

        let trimmed = stripped.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { throw ExtractionError.noTextContent }
        return trimmed
    }
}
