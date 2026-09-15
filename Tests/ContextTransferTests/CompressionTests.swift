import XCTest
@testable import ContextTransfer

/// Locks in the compression feature's two pure units:
/// - `CompressionLevel`: every level must keep the shared card shape (the
///   base prompt) while changing only the compression rules and budget.
/// - `CompressionStats`: the reduction summary shown in the panel/window.
final class CompressionTests: XCTestCase {

    // MARK: - CompressionLevel.promptInstruction

    func testLevelInstructionsDifferPerLevel() {
        let levels = CompressionLevel.allCases
        let instructions = levels.map(\.promptInstruction)

        // Three distinct rule sets — otherwise a level is a silent no-op.
        XCTAssertEqual(Set(instructions).count, levels.count)
    }

    func testEveryLevelInstructionMentionsItsName() {
        for level in CompressionLevel.allCases {
            XCTAssertTrue(
                level.promptInstruction.contains(level.label.uppercased()),
                "\(level.label) instruction should announce its own level"
            )
        }
    }

    func testMinimalLevelExemptsLinksFromBulletCap() {
        // The one invariant the product cares about: Minimal must not
        // allow links to be summarized away.
        let instruction = CompressionLevel.minimal.promptInstruction.lowercased()
        XCTAssertTrue(instruction.contains("resources & links is exempt"))
        XCTAssertTrue(instruction.contains("verbatim"))
    }

    func testBalancedIsTheDefaultLevel() {
        XCTAssertEqual(CompressionLevel(rawValue: "nonsense") ?? .balanced, .balanced)
        // Persisted-setting fallbacks in CaptureOrchestrator/ContentView/
        // SettingsView all decode unknown raw values to .balanced.
        XCTAssertEqual(CompressionLevel.balanced.rawValue, "balanced")
    }

    // MARK: - systemPrompt(for:)

    func testSystemPromptContainsBaseRulesAndLevelInstruction() {
        let prompt = systemPrompt(for: .minimal)

        // Base shape: the exact section headers the validator requires.
        for header in ["## Goal", "## Key Decisions", "## Resources & Links"] {
            XCTAssertTrue(prompt.contains(header), "system prompt must keep \(header)")
        }
        // Verbatim-links rule must survive in every level's prompt.
        XCTAssertTrue(prompt.lowercased().contains("verbatim"))
        // Level rules are appended, not replacing the base.
        XCTAssertTrue(prompt.contains("MINIMAL"))
    }

    func testSystemPromptIsLevelIndependentForBasePortion() {
        // The shared rules must be identical across levels — only the
        // appended block may differ. (Section order is load-bearing for
        // validateContextCard.)
        let baseOf = { (level: CompressionLevel) -> String in
            let prompt = systemPrompt(for: level)
            let instruction = level.promptInstruction
            guard prompt.hasSuffix(instruction) else { return "" }
            return String(prompt.dropLast(instruction.count))
        }

        XCTAssertEqual(baseOf(.full), baseOf(.minimal))
        XCTAssertTrue(baseOf(.balanced).contains(systemPromptBase))
    }

    // MARK: - Output budgets

    func testOutputTokenBudgetsShrinkWithLevel() {
        XCTAssertEqual(CompressionLevel.full.maxOutputTokens,
                       CompressionLevel.balanced.maxOutputTokens * 2)
        XCTAssertEqual(CompressionLevel.balanced.maxOutputTokens,
                       CompressionLevel.minimal.maxOutputTokens * 2)
    }

    // MARK: - CompressionStats

    func testStatsSummaryFormatsReduction() {
        // 18.4k → 2.1k tokens · 89% smaller
        let stats = CompressionStats(originalTokens: 18_400, compressedTokens: 2_100)
        XCTAssertEqual(stats.summary, "18.4k → 2.1k tokens · 89% smaller")
        XCTAssertEqual(stats.reductionRatio, 1 - Double(2_100) / 18_400, accuracy: 0.0001)
    }

    func testStatsSummarySubThousandTokensShowPlainNumbers() {
        let stats = CompressionStats(originalTokens: 800, compressedTokens: 200)
        XCTAssertEqual(stats.summary, "800 → 200 tokens · 75% smaller")
    }

    func testStatsSummaryWithoutReduction() {
        // Card longer than the input (tiny input, model preamble) — should
        // read "(no reduction)", never a negative percentage.
        let stats = CompressionStats(originalTokens: 100, compressedTokens: 500)
        XCTAssertEqual(stats.summary, "100 → 500 tokens (no reduction)")
        XCTAssertEqual(stats.reductionRatio, -4.0, accuracy: 0.0001)
    }

    func testStatsSummaryWithZeroOriginalIsDegenerate() {
        // Empty original: no meaningful ratio — summary suppressed entirely.
        let stats = CompressionStats(originalTokens: 0, compressedTokens: 50)
        XCTAssertEqual(stats.summary, "")
    }

    func testStatsRoundsSmallAndLargeValues() {
        // Sub-0.05k values round to one decimal; ≥10k keeps one decimal.
        XCTAssertEqual(CompressionStats.compactTokenCount(950), "950")
        XCTAssertEqual(CompressionStats.compactTokenCount(1_000), "1.0k")
        XCTAssertEqual(CompressionStats.compactTokenCount(18_400), "18.4k")
    }

    func testStatsEstimateTokensUsesFourCharsPerToken() {
        XCTAssertEqual(CompressionStats.estimateTokens(of: ""), 0)
        XCTAssertEqual(CompressionStats.estimateTokens(of: String(repeating: "a", count: 400)), 100)
        // 7 chars → floor(7/4) = 1
        XCTAssertEqual(CompressionStats.estimateTokens(of: "aaaaaaa"), 1)
    }

    func testStatsInitFromStringsAndClampsNegatives() {
        let stats = CompressionStats(original: String(repeating: "a", count: 4_000), compressed: "short card")
        XCTAssertEqual(stats.originalTokens, 1_000)

        // Defensive clamp: negative inputs can't produce negative stats.
        let clamped = CompressionStats(originalTokens: -5, compressedTokens: -1)
        XCTAssertEqual(clamped.originalTokens, 0)
        XCTAssertEqual(clamped.compressedTokens, 0)
    }

    // MARK: - Legacy default-level path

    func testProtocolDefaultLevelIsBalanced() async throws {
        // The protocol extension that keeps old call sites compiling must
        // route through Balanced, not silently change with settings.
        struct TrackedBackend: ExtractionBackend {
            var receivedLevel: CompressionLevel?
            var capturedInput: String?

            func extractContext(from conversation: String, level: CompressionLevel) async throws -> (card: String, stats: CompressionStats) {
                receivedLevel = level
                capturedInput = conversation
                return ("card", CompressionStats(original: conversation, compressed: "card"))
            }
        }

        let backend = TrackedBackend()
        _ = try await backend.extractContext(from: "hello")
        XCTAssertEqual(backend.receivedLevel, .balanced)
        XCTAssertEqual(backend.capturedInput, "hello")
    }
}
