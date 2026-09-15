# Contributing to Context Transfer

Thanks for your interest! This is a small, dependency-free macOS app — contributions that keep it that way are especially welcome.

## Building locally

Requirements: **macOS 13+** and **Swift 5.9+** (Xcode 15+ toolchain; the project builds with SwiftPM via the build script, no `.xcodeproj` needed).

```bash
git clone https://github.com/Shivala-08/context-shifter.git
cd context-shifter
./Scripts/build-app.sh
open ".build/app/Context Transfer.app"
```

> **Rebuild tip:** ad-hoc builds change code identity on every rebuild, and macOS binds the Accessibility grant to that identity — after a rebuild the capture shortcut silently dies until you re-grant. Fix permanently by creating a self-signed code-signing cert once (Keychain Access → Certificate Assistant → Create Certificate → name `ContextTransferDev`, type *Code Signing*), then build with `SIGN_IDENTITY="ContextTransferDev" ./Scripts/build-app.sh`.

## Project conventions

- **Zero third-party dependencies.** SwiftUI + AppKit only; `URLSession` for all HTTP. Don't add package dependencies.
- **Two interchangeable backends** (local Ollama, cloud Anthropic) behind the `ExtractionBackend` protocol — keep app logic backend-agnostic.
- **API keys live in the Keychain** (`KeychainHelper`), never in `UserDefaults` or source.
- Match the existing code style; keep comments for the *why*, not the *what*.

## Submitting a pull request

- **One feature or fix per PR.** Keep diffs focused.
- Branch naming: `feat/short-description`, `fix/short-description`, `docs/short-description`.
- Before opening the PR, confirm:
  - [ ] The project builds locally (`./Scripts/build-app.sh`)
  - [ ] If your change touches the extraction path, you tested against **both** the local (Ollama) and cloud (Anthropic) backends
  - [ ] No secrets, API keys, or personal paths are committed

For bug reports and feature requests, use the [issue templates](.github/ISSUE_TEMPLATE) — including your macOS version and which backend you're using makes issues much faster to reproduce.
