import AppKit
import CryptoKit
import os

/// Detects the "I already granted Accessibility but a rebuild lost it" case.
///
/// Ad-hoc-signed builds change code identity on every rebuild, and macOS TCC
/// binds Accessibility grants to that identity. The result is baffling for the
/// user: the app looks identical, System Settings shows an allowed entry (for
/// the OLD build), yet every capture silently dies at the trust gate.
///
/// Whenever the app IS trusted, we record the binary's code hash in
/// UserDefaults. On a later launch where the app is NOT trusted, comparing
/// the stored hash against the current one tells us which story is true:
///   - hashes differ  → this is a NEW build; the grant belonged to the old
///     one. Tell the user exactly that: re-grant once, and pin the identity
///     (stable signing) so it doesn't happen again.
///   - hashes match    → same binary; macOS actually revoked trust (rare —
///     TCC reset, profile change). Plain re-grant is the fix.
enum TrustMonitor {
    private static let trustedCodeHashKey = "trustedCodeSHA256"

    /// SHA-256 of the running bundle's main executable. Nil when the code is
    /// unsigned in a way we can't hash (shouldn't happen for signed bundles).
    static var currentCodeHash: String? {
        guard let url = Bundle.main.executableURL,
              let data = try? Data(contentsOf: url)
        else { return nil }
        return SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    private static var storedTrustedHash: String? {
        UserDefaults.standard.string(forKey: trustedCodeHashKey)
    }

    /// Call when trust is confirmed (launch trusted, or grant completes).
    /// Persists the hash of the binary that holds the grant.
    static func recordTrusted() {
        guard let hash = currentCodeHash else { return }
        UserDefaults.standard.set(hash, forKey: trustedCodeHashKey)
        CaptureLogger.orchestrator.info("trust confirmed for this build (code hash \(hash.prefix(12))… recorded)")
    }

    /// True when the stored trusted hash exists but doesn't match this
    /// binary — i.e. this looks like the rebuild-lost-the-grant case.
    static var grantBelongsToDifferentBuild: Bool {
        guard let stored = storedTrustedHash, let current = currentCodeHash else { return false }
        return stored != current
    }

    /// The explanation shown to the user / written to the trail.
    static var rebuiltBinaryExplanation: String {
        """
        Accessibility was granted to an earlier build — this rebuilt binary has a \
        different code signature, so macOS silently treats it as untrusted. \
        Re-add THIS app once under System Settings → Privacy & Security → \
        Accessibility (remove the stale entry first).
        """
    }

    /// One-line version for the capture trail.
    static var rebuiltBinaryTrailNote: String {
        "trust lost after rebuild: the Accessibility grant belongs to a previous build (stored hash \(storedTrustedHash.map { String($0.prefix(12)) } ?? "?")…, this binary \(currentCodeHash.map { String($0.prefix(12)) } ?? "?")…)"
    }
}
