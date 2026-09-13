# PRD — Context Transfer

## 1. Problem
Context built up in one AI/app conversation is trapped there. Switching tools (ChatGPT → Claude, or one project chat → another) means re-explaining goals, decisions, and constraints from scratch. There's no lightweight way to carry that context across apps.

## 2. Goal
A personal utility that captures conversational/work context and turns it into a portable "context card" that can be dropped into a new session anywhere, with minimal friction — ideally without breaking flow to copy-paste manually.

## 3. Users
- **v1**: just you, for your own workflow across ChatGPT/Claude/other tools.
- **v2+**: potentially scoped for other devs/students doing the same kind of multi-tool AI work, if it proves useful enough to share.

## 4. Scope by phase

### Phase 1 — Paste-in tool (built)
- Paste a conversation into a text box
- Extract a structured context card (Goal, Key Decisions, Constraints & Preferences, Current State, Open Questions)
- Copy the card out to paste elsewhere
- Choice of extraction backend: cloud (Anthropic API) or local (Ollama/Llama 8B)

### Phase 2 — Always-available quick capture
- App lives in the **menu bar**, not a regular window you have to switch to
- A **global keyboard shortcut** works from any app: select text anywhere on screen, hit the shortcut, and the app captures it without needing to switch apps or manually copy first
- Captured text is run through the same extraction pipeline as Phase 1
- Result appears in a small **floating panel** near the cursor (or a fixed corner of the screen) that stays on top of other windows, with a copy button
- Panel dismisses on click-away or a second shortcut press

### Out of scope (both phases)
- No cloud sync or multi-device support
- No persistent history/database of past captures (each capture is transient)
- No automatic detection of *which* app you're capturing from or app-specific parsing — it's just "whatever text is selected"
- No mobile version

## 5. Key user stories
- As the user, I can paste a long conversation and get back a short, structured card I can immediately reuse.
- As the user, I can select a paragraph in any app, hit a shortcut, and get a context card without switching windows or copying manually.
- As the user, I can choose whether extraction happens locally (private, free, lower quality) or via the cloud (better quality, needs API key/cost).
- As the user, if extraction fails (no API key, Ollama not running, nothing selected), I get a clear, specific message — not a silent failure.

## 6. Success criteria
- Using it end-to-end (select → capture → paste elsewhere) takes under ~10 seconds of user interaction, excluding model latency.
- Extraction card is usable as-is as a first message in a new session at least 80% of the time (i.e., minimal manual editing needed).
- Local backend produces a "good enough" card for routine use; cloud backend is the fallback for anything important.

## 7. Risks / open questions
- Accessibility-permission friction: macOS will prompt the user once to grant Accessibility access for the global-capture feature — acceptable for a personal tool, worth a clear explanation in-app since it's a common trust barrier.
- 8B local model may produce inconsistent section formatting compared to Sonnet — needs real testing, not just assumed to work.
- If this gets shared with others later, distributing outside the Mac App Store (required for the synthetic-copy mechanism) means handling your own notarization — not a blocker for personal use, but a real step before any wider release.
