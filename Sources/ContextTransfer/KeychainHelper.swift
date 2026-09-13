import Foundation
import Security

/// Task 4c — the Anthropic API key must NOT live in @AppStorage/UserDefaults
/// (plaintext, readable by anything with access to the account or defaults
/// backups). It's stored as a single generic password item instead.
enum KeychainHelper {
    static let service = "com.contexttransfer.app.anthropicKey"

    // MARK: - CRUD

    @discardableResult
    static func save(_ secret: String) -> Bool {
        guard let data = secret.data(using: .utf8) else { return false }

        // Update in place when the item already exists.
        let update: [String: Any] = [kSecValueData as String: data]
        let updateStatus = SecItemUpdate(query(), update as CFDictionary)
        if updateStatus == errSecSuccess { return true }

        let attributes: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock,
        ]
        return SecItemAdd(attributes as CFDictionary, nil) == errSecSuccess
    }

    static func load() -> String? {
        var result: AnyObject?
        let status = SecItemCopyMatching(query() as CFDictionary, &result)
        guard status == errSecSuccess, let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    @discardableResult
    static func delete() -> Bool {
        SecItemDelete(query() as CFDictionary) == errSecSuccess
    }

    private static func query() -> CFDictionary {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecReturnData as String: true,
        ] as CFDictionary
    }

    // MARK: - Legacy migration

    /// One-time migration: an earlier build persisted the key in UserDefaults.
    /// Move it to the Keychain and scrub the defaults entry.
    static func migrateFromUserDefaultsIfNeeded(defaults: UserDefaults = .standard) {
        guard load()?.isEmpty ?? true else { return } // already have a key
        let legacyKey = "anthropicAPIKey"
        guard let legacy = defaults.string(forKey: legacyKey), !legacy.isEmpty else { return }
        if save(legacy) {
            defaults.removeObject(forKey: legacyKey)
        }
    }
}
