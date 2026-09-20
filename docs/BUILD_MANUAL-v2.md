# Build Manual: Context Transfer (native macOS app)

## Goal
A native macOS app (SwiftUI) that takes a pasted LLM/app conversation, extracts a portable "context card" (goal, decisions, constraints, current state, open questions), and lets the user copy it to paste into a different app/LLM to resume work there. Single-shot, no persistence required for v1.

## Tech stack
- Swift 5.9+, SwiftUI, macOS 13+ target
- Xcode project (App template, SwiftUI interface, no Core Data, no tests)
- No third-party dependencies — use URLSession directly for all HTTP calls

## Architecture
Two interchangeable extraction backends behind one protocol, selectable in Settings:

1. **Cloud backend** — Anthropic API (`https://api.anthropic.com/v1/messages`), model `claude-sonnet-4-6`, requires user's own API key.
2. **Local backend** — Ollama running on the user's Mac (`http://localhost:11434/api/generate`), model `qwen3:8b` (or whatever the user has pulled), no API key required, requires Ollama to be installed and running.

Both backends receive the same system prompt and return the same markdown-formatted context card, so the rest of the app is backend-agnostic.

## File structure
```
ContextTransfer/
  ContextTransferApp.swift      // @main entry point
  ContentView.swift             // paste-in / extract / copy-out UI
  SettingsView.swift            // backend picker + API key + Ollama model/host fields
  ExtractionBackend.swift       // protocol + shared system prompt
  AnthropicBackend.swift        // cloud implementation
  OllamaBackend.swift           // local implementation
  README.md                     // setup instructions (write last)
```

## Task 1 — Scaffold the Xcode project
- Create a new macOS App target named `ContextTransfer`, SwiftUI interface, Swift language, no Core Data, no tests.
- Set deployment target to macOS 13.0.
- In target → Signing & Capabilities, ensure **App Sandbox** is enabled with **Outgoing Connections (Client)** checked. This is required for both the Anthropic HTTPS call and the localhost call to Ollama — sandboxed apps block all outbound network by default without this.

## Task 2 — Define the shared backend protocol
Create `ExtractionBackend.swift`:
- A protocol `ExtractionBackend` with one async throwing method: `extractContext(from conversation: String) async throws -> String`.
- A shared constant `systemPrompt` (string) used by both backends, instructing the model to output ONLY a markdown block with these exact sections, in this order, bullet points, no preamble:
  - `## Goal`
  - `## Key Decisions`
  - `## Constraints & Preferences`
  - `## Current State`
  - `## Resources & Links`
  - `## Open Questions`
  - Each section should say "None noted." if empty. Keep it tight — it's meant to be pasted as a first message elsewhere, not read as a report.
  - **Resources & Links must be copied verbatim, never paraphrased or summarized.** Any URL, file path, exact filename, arxiv ID, or similar concrete reference that appears in the source conversation goes here exactly as written. This is the one section where losing precision is worse than losing brevity — a model reading the card later can reconstruct a paraphrased decision, but it cannot reconstruct a dropped or altered link; it will guess, and a guessed link is worse than no link.
  - Also prepend a **Captured on: <today's date>** line above `## Goal`, so a card read later carries its own freshness signal instead of reading as perpetually current.

## Task 3 — Implement the cloud backend
Create `AnthropicBackend.swift`:
- Struct conforming to `ExtractionBackend`, holding an `apiKey: String`.
- POST to `https://api.anthropic.com/v1/messages` with headers `x-api-key`, `anthropic-version: 2023-06-01`, `content-type: application/json`.
- Body: `{"model": "claude-sonnet-4-6", "max_tokens": 1500, "system": <systemPrompt>, "messages": [{"role": "user", "content": "Here is the conversation to extract context from:\n\n<conversation>"}]}`.
- Parse response JSON, extract text from `content[].text`, join, return.
- Throw a descriptive error if the API key is empty, if the HTTP status isn't 200 (include status code and body in the error), or if no text content comes back.

## Task 4 — Implement the local backend
Create `OllamaBackend.swift`:
- Struct conforming to `ExtractionBackend`, holding `host: String` (default `"http://localhost:11434"`) and `model: String` (default `"qwen3:8b"`).
- POST to `<host>/api/generate` with JSON body `{"model": <model>, "prompt": "<systemPrompt>\n\n<conversation to extract from>\n\n<conversation>", "stream": false, "options": {"num_ctx": 8192}}`.
- **Set `num_ctx` explicitly.** Ollama's default context window (often 2K–4K tokens depending on the model) will silently truncate long pasted conversations with no error — the model just never sees the end of the input. 8192 is a safe floor for this use case; if the source conversation could realistically exceed that, estimate token count (roughly `characters / 4`) before sending and warn the user in the UI rather than sending truncated input silently.
- Note: Ollama's `/api/generate` doesn't have a separate system-prompt field the same way the Anthropic API does — concatenate the system prompt and the conversation into a single `prompt` string as shown above.
- Parse response JSON, read the `response` field (a plain string), return it trimmed.
- Throw a descriptive, actionable error on connection failure specifically suggesting: "Couldn't reach Ollama at <host>. Run `ollama serve` and make sure the model is pulled (`ollama pull <model>`)."
- If the HTTP response is a 500 and the body mentions memory/allocation (check for substrings like "memory" or "allocate"), surface a specific error: "Ollama ran out of memory loading this model. Try a smaller model or close other apps." — don't let this fall through to the generic connection-failure message, since the fix is different.

## Task 4b — Validate output shape before showing it
Create a small helper (e.g. a static function on `ExtractionBackend` or a free function `validateContextCard(_ text: String) -> Bool`):
- After either backend returns text, check that all required headers are present: `Captured on:`, `## Goal`, `## Key Decisions`, `## Constraints & Preferences`, `## Current State`, `## Resources & Links`, `## Open Questions`.
- If any are missing (common failure mode for smaller local models — dropped headers, renamed sections, or an added conversational preamble before the markdown starts), **retry once** with a follow-up message appended to the prompt: "Your previous output was missing required section(s). Output ONLY the markdown card with all required headers, exactly as specified, with no other text."
- If the retry also fails validation, show the output anyway but prepend a visible warning in the UI: "⚠️ This card may be missing sections — the model didn't follow the expected format. Review before using." Never silently hide a malformed result — the user needs to know to double-check it, especially for the Resources & Links section where a dropped header could mean a lost link.

## Task 4c — API key storage (security fix)
Do NOT store the Anthropic API key in `@AppStorage`/`UserDefaults` — it's stored in plaintext and readable by anything with access to the user's account or defaults backups. Instead:
- Add a small `KeychainHelper` using the `Security` framework (`SecItemAdd`/`SecItemCopyMatching`/`SecItemUpdate`) to save/read/delete a single generic password item keyed by a fixed service string (e.g. `"com.yourname.ContextTransfer.anthropicKey"`).
- `SettingsView` reads/writes through `KeychainHelper` instead of `@AppStorage` for the API key field specifically. `backendType`, `ollamaHost`, and `ollamaModel` are fine to keep in `@AppStorage` — they aren't secrets.

## Task 5 — Build the main UI
Create `ContentView.swift`:
- `HSplitView` with two panes.
- Left pane: `TextEditor` bound to `inputText`, an "Extract Context" button (disabled while loading or input empty, Cmd+Return shortcut), a "Clear" button, and a gear-icon button opening Settings.
- Right pane: scrollable, selectable `Text` showing `outputText` (placeholder text when empty), a "Copy" button (uses `NSPasteboard.general`) that briefly flips to "Copied", and an inline error message area.
- On "Extract Context": construct the currently-selected backend (see Task 6) and call `extractContext(from:)` in a `Task`, showing a spinner while awaiting, populating `outputText` on success or `errorMessage` on failure.
- **Cold-start hint for local backend**: if `backendType` is Local, show the loading spinner with a secondary label "First run may take longer while the model loads…" — Ollama loads the model into memory on first request after being idle, which can take noticeably longer than subsequent calls. Without this hint, a slow first run looks indistinguishable from a hang.

## Task 6 — Settings and backend selection
Create `SettingsView.swift`, presented as a sheet:
- A `Picker` (segmented control) for backend: "Local (Ollama)" vs "Cloud (Anthropic)".
- **Default `backendType` is Local (Ollama)** — a fresh install should work fully offline with no API key prompt. Cloud stays available as an opt-in for when extraction quality matters more than speed/privacy.
- When Local is selected: a text field for the Ollama host (default `http://localhost:11434`) and a text field for the model name (default `qwen3:8b`).
- When Cloud is selected: a `SecureField` for the Anthropic API key.
- Persist all four values (`backendType`, `ollamaHost`, `ollamaModel`, `anthropicAPIKey`) via `@AppStorage` so they survive app restarts.
- `ContentView` reads these `@AppStorage` values to construct the right backend instance before each extraction call.

## Task 7 — Wire it together
- `ContextTransferApp.swift`: standard `@main` App struct, single `WindowGroup` containing `ContentView`, min window size ~900x600.
- Verify: switching the backend picker in Settings actually changes which backend `ContentView` uses on the next extraction — don't cache the backend instance across the picker changing.

## Task 8 — Write README.md
Cover: how to open in Xcode and run (Cmd+R), how to get an Anthropic key (console.anthropic.com) OR how to install Ollama and pull a model (`brew install ollama`, `ollama pull qwen3:8b`, `ollama serve`), and the App Sandbox / Outgoing Connections capability requirement from Task 1.

## Acceptance checklist
- [ ] App builds and runs via Cmd+R with no errors
- [ ] Cloud backend: valid API key → paste conversation → Extract → structured card appears → Copy works
- [ ] Local backend: Ollama running with model pulled → same flow works without any API key
- [ ] Missing API key (cloud) or unreachable Ollama (local) shows a clear, specific error — not a silent failure or generic crash
- [ ] Backend choice and credentials persist after quitting and relaunching the app
