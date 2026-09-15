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
2. **Local backend** — Ollama running on the user's Mac (`http://localhost:11434/api/generate`), model `llama3.1:8b` (or whatever the user has pulled), no API key required, requires Ollama to be installed and running.

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
  - `## Open Questions`
  - Each section should say "None noted." if empty. Keep it tight — it's meant to be pasted as a first message elsewhere, not read as a report.

## Task 3 — Implement the cloud backend
Create `AnthropicBackend.swift`:
- Struct conforming to `ExtractionBackend`, holding an `apiKey: String`.
- POST to `https://api.anthropic.com/v1/messages` with headers `x-api-key`, `anthropic-version: 2023-06-01`, `content-type: application/json`.
- Body: `{"model": "claude-sonnet-4-6", "max_tokens": 1500, "system": <systemPrompt>, "messages": [{"role": "user", "content": "Here is the conversation to extract context from:\n\n<conversation>"}]}`.
- Parse response JSON, extract text from `content[].text`, join, return.
- Throw a descriptive error if the API key is empty, if the HTTP status isn't 200 (include status code and body in the error), or if no text content comes back.

## Task 4 — Implement the local backend
Create `OllamaBackend.swift`:
- Struct conforming to `ExtractionBackend`, holding `host: String` (default `"http://localhost:11434"`) and `model: String` (default `"llama3.1:8b"`).
- POST to `<host>/api/generate` with JSON body `{"model": <model>, "prompt": "<systemPrompt>\n\n<conversation to extract from>\n\n<conversation>", "stream": false}`.
- Note: Ollama's `/api/generate` doesn't have a separate system-prompt field the same way the Anthropic API does — concatenate the system prompt and the conversation into a single `prompt` string as shown above.
- Parse response JSON, read the `response` field (a plain string), return it trimmed.
- Throw a descriptive, actionable error on connection failure specifically suggesting: "Couldn't reach Ollama at <host>. Run `ollama serve` and make sure the model is pulled (`ollama pull <model>`)."

## Task 5 — Build the main UI
Create `ContentView.swift`:
- `HSplitView` with two panes.
- Left pane: `TextEditor` bound to `inputText`, an "Extract Context" button (disabled while loading or input empty, Cmd+Return shortcut), a "Clear" button, and a gear-icon button opening Settings.
- Right pane: scrollable, selectable `Text` showing `outputText` (placeholder text when empty), a "Copy" button (uses `NSPasteboard.general`) that briefly flips to "Copied", and an inline error message area.
- On "Extract Context": construct the currently-selected backend (see Task 6) and call `extractContext(from:)` in a `Task`, showing a spinner while awaiting, populating `outputText` on success or `errorMessage` on failure.

## Task 6 — Settings and backend selection
Create `SettingsView.swift`, presented as a sheet:
- A `Picker` (segmented control) for backend: "Cloud (Anthropic)" vs "Local (Ollama)".
- When Cloud is selected: a `SecureField` for the Anthropic API key.
- When Local is selected: a text field for the Ollama host (default `http://localhost:11434`) and a text field for the model name (default `llama3.1:8b`).
- Persist all four values (`backendType`, `anthropicAPIKey`, `ollamaHost`, `ollamaModel`) via `@AppStorage` so they survive app restarts.
- `ContentView` reads these `@AppStorage` values to construct the right backend instance before each extraction call.

## Task 7 — Wire it together
- `ContextTransferApp.swift`: standard `@main` App struct, single `WindowGroup` containing `ContentView`, min window size ~900x600.
- Verify: switching the backend picker in Settings actually changes which backend `ContentView` uses on the next extraction — don't cache the backend instance across the picker changing.

## Task 8 — Write README.md
Cover: how to open in Xcode and run (Cmd+R), how to get an Anthropic key (console.anthropic.com) OR how to install Ollama and pull a model (`brew install ollama`, `ollama pull llama3.1:8b`, `ollama serve`), and the App Sandbox / Outgoing Connections capability requirement from Task 1.

## Acceptance checklist
- [ ] App builds and runs via Cmd+R with no errors
- [ ] Cloud backend: valid API key → paste conversation → Extract → structured card appears → Copy works
- [ ] Local backend: Ollama running with model pulled → same flow works without any API key
- [ ] Missing API key (cloud) or unreachable Ollama (local) shows a clear, specific error — not a silent failure or generic crash
- [ ] Backend choice and credentials persist after quitting and relaunching the app
