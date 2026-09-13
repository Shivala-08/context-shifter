import Foundation
import ServiceManagement

/// Launch-at-login via SMAppService (macOS 13+, matches our deployment
/// target). Registers the running .app bundle with launchd's per-user GUI
/// domain so launchd re-launches it at login; unregistration removes it.
/// NOTE: only works from a bundled .app (not `swift run` from a bare binary).
enum LaunchAtLogin {
    static var isEnabled: Bool {
        SMAppService.mainApp.status == .enabled
    }

    /// Idempotent toggle used by Settings. Registration may put the app in
    /// `.requiresApproval` until the user confirms in System Settings >
    /// General > Login Items; `status` reflects that, not `isEnabled`.
    static func setEnabled(_ enabled: Bool) {
        guard enabled != isEnabled else { return }
        if enabled {
            try? SMAppService.mainApp.register()
        } else {
            try? SMAppService.mainApp.unregister()
        }
    }
}
