import Foundation

/// Common interface for both extraction backends so the rest of the app is
/// backend-agnostic (cloud Anthropic vs. local Ollama).
protocol ExtractionBackend {
    /// Extracts a card at the requested compression level and reports how much
    /// the source shrank. The one method conformers must implement.
    func extractContext(
        from conversation: String,
        level: CompressionLevel
    ) async throws -> (card: String, stats: CompressionStats)
}

extension ExtractionBackend {
    /// Legacy default-level path kept so old call sites compiling against the
    /// pre-levels signature keep working: routes through Balanced, never the
    /// user's current setting.
    func extractContext(from conversation: String) async throws -> String {
        try await extractContext(from: conversation, level: .balanced).card
    }
}

/// How aggressively the model should compress the conversation into a card.
/// Persisted as a raw string in UserDefaults (SettingsKeys.compressionLevel).
enum CompressionLevel: String, CaseIterable, Identifiable {
    /// Preserve the most detail — everything the model deems relevant.
    case full
    /// The default: trim small talk and filler, keep decisions and links.
    case balanced
    /// Smallest possible card: goal, key decisions, links only.
    case minimal

    var id: String { rawValue }

    var label: String {
        switch self {
        case .full: return "Full"
        case .balanced: return "Balanced"
        case .minimal: return "Minimal"
        }
    }

    /// One-line explanation shown under the Settings picker.
    var explanation: String {
        switch self {
        case .full:
            return "Keep the most detail — thorough bullets in every section."
        case .balanced:
            return "Trim filler and small talk; keep decisions, constraints, and links."
        case .minimal:
            return "Smallest card — goal, key decisions, and links only."
        }
    }

    /// Extra rules appended to the shared system prompt for this level.
    var promptInstruction: String {
        switch self {
        case .full:
            return """
            Compression level: FULL.
            - Preserve as much relevant detail as the sections allow: full decision rationale, specific names/values, exact versions, and error messages.
            - Never drop concrete facts to save space.
            """
        case .balanced:
            return """
            Compression level: BALANCED (default).
            - Drop greetings, filler, and small talk entirely.
            - Keep every decision, constraint, open question, and link.
            - Compress background narrative into a single bullet per topic.
            """
        case .minimal:
            return """
            Compression level: MINIMAL.
            - Output at most 2 bullets per section (Resources & Links is exempt: every link goes in verbatim).
            - Each bullet must be one short sentence. Omit all background, narrative, and rationale.
            - If a decision depends on missing context, note that dependency in a few words instead of explaining it.
            """
        }
    }

    /// Hard output cap passed to the backend. Also nudges Anthropic's
    /// max_tokens and Ollama's num_predict so a chatty model can't undo
    /// the level's intent.
    var maxOutputTokens: Int {
        switch self {
        case .full: return 2048
        case .balanced: return 1024
        case .minimal: return 512
        }
    }
}

/// Original-vs-card size accounting, shown in the UI so the user sees what
/// the compression bought them (e.g. "18.4k → 2.1k tokens (89% smaller)").
/// Tokens use the same ~4-chars-per-token heuristic as OllamaBackend.
struct CompressionStats: Equatable {
    let originalTokens: Int
    let compressedTokens: Int

    init(originalTokens: Int, compressedTokens: Int) {
        self.originalTokens = max(0, originalTokens)
        self.compressedTokens = max(0, compressedTokens)
    }

    init(original: String, compressed: String) {
        self.init(
            originalTokens: Self.estimateTokens(of: original),
            compressedTokens: Self.estimateTokens(of: compressed)
        )
    }

    /// 0.0–1.0 fraction of the original that the card occupies.
    var reductionRatio: Double {
        guard originalTokens > 0 else { return 0 }
        return 1 - Double(compressedTokens) / Double(originalTokens)
    }

    /// "18.4k → 2.1k tokens · 89% smaller" — empty for degenerate inputs.
    var summary: String {
        guard originalTokens > 0 else { return "" }
        let pct = Int((reductionRatio * 100).rounded())
        let pctText = pct > 0 ? " · \(pct)% smaller" : " (no reduction)"
        return "\(Self.compactTokenCount(originalTokens)) → \(Self.compactTokenCount(compressedTokens)) tokens\(pctText)"
    }

    /// ~4 characters per token, matching OllamaBackend.estimatedTokenCount.
    static func estimateTokens(of text: String) -> Int {
        text.count / 4
    }

    /// "18400" → "18.4k" so the panel line stays short.
    static func compactTokenCount(_ tokens: Int) -> String {
        tokens >= 1000 ? String(format: "%.1fk", Double(tokens) / 1000) : "\(tokens)"
    }
}

/// Shared system prompt: both backends receive the exact same instructions so
/// their output shape is interchangeable. The compression level's rules are
/// appended per call so Full/Balanced/Minimal share one card shape.
let systemPromptBase = """
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

/// Base rules + the selected compression level's extra instructions.
func systemPrompt(for level: CompressionLevel) -> String {
    "\(systemPromptBase)\n\n\(level.promptInstruction)"
}

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
        var trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)

        // Local models frequently wrap the whole card in a ```markdown fence
        // even though the prompt forbids it — strip a wrapping fence so the
        // card starts at "Captured on:"/"## Goal" instead of fence syntax.
        // Only a leading fence triggers this, so legitimate code blocks
        // inside the card body are untouched.
        if trimmed.hasPrefix("```") {
            if let firstNewline = trimmed.firstIndex(of: "\n") {
                trimmed = String(trimmed[trimmed.index(after: firstNewline)...])
            } else {
                trimmed = ""
            }
            if trimmed.hasSuffix("```") {
                trimmed = String(trimmed[..<trimmed.index(trimmed.endIndex, offsetBy: -3)])
            }
            trimmed = trimmed.trimmingCharacters(in: .whitespacesAndNewlines)
        }

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
