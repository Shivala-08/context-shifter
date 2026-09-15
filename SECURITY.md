# Security Policy

## Reporting a vulnerability

Please report vulnerabilities **privately** — do not open a public issue.

- Preferred: GitHub's private vulnerability reporting (**Security → Report a vulnerability** on this repo)
- Fallback: email the maintainer directly

Include steps to reproduce or a proof of concept if you can. You'll get an acknowledgment within a few days and a fix timeline once the issue is confirmed.

## Data handling

Context Transfer is local-first:

- **No telemetry, analytics, or crash reporting.** Nothing leaves your machine unless you explicitly configure a cloud backend.
- Captured text goes only to the extraction backend you selected:
  - **Local (Ollama, the default):** everything stays on your machine (`localhost:11434`).
  - **Cloud (Anthropic):** captured text is sent to `api.anthropic.com` using your own API key, stored in your macOS **Keychain** — never in plaintext preferences or the source.
- The clipboard is only read on an explicit capture shortcut and the original clipboard contents are restored afterwards.
