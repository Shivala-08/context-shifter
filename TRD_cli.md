# TRD — Context Transfer CLI

## 1. Location in the repo
Lives in `/cli` inside the same repo as the Swift app — **not** the repo root, since `package.json` needs to sit wherever `npm publish` is run from, and the repo root is already an Xcode project structure.
```
/cli
  bin/context-transfer.js
  src/
    backends/
      ollama.js
      anthropic.js
      nim.js
    prompt.js
    validate.js
  package.json
  README.md            (CLI-specific usage, linked from the main repo README)
```

## 2. Runtime & dependencies
- Node.js, target LTS (specify a minimum, e.g. `"engines": { "node": ">=18" }` in package.json since Node 18+ has native `fetch` — no need for `node-fetch` or `axios` as a dependency).
- Use Node's built-in `util.parseArgs` for flag parsing instead of pulling in `commander` or `yargs` — the flag surface here (`--backend`, `--model`, `--file`, `--json`) is small enough that a dependency-free parser keeps the package lightweight and avoids supply-chain surface area for something this small.
- Zero runtime dependencies is the goal for v1.

## 3. Shared prompt — solving the drift risk from the PRD
Store the extraction system prompt in **one canonical file** that both codebases read from, rather than hardcoding it separately in Swift and JS:
- Add `/prompt/extraction-template.md` at the repo root as the single source of truth.
- Swift's `ExtractionBackend.systemPrompt` and the CLI's `src/prompt.js` should both load this file's contents at build/runtime rather than embedding the string directly — for the CLI this is trivial (`fs.readFileSync` relative to the package), for Swift it means bundling the file as a resource and reading it via `Bundle.main.path(forResource:)`.
- If bundling the file into the Swift app is more friction than it's worth for v1, the fallback is a manual-sync discipline: a comment at the top of both `systemPrompt` locations saying "keep in sync with /prompt/extraction-template.md" — worse than a real shared source, but better than no acknowledgment that drift is possible.

## 4. Backend implementations
Each backend module exports one async function: `extract(text, options) -> Promise<string>`.

### `ollama.js`
- POST to `http://localhost:11434/api/generate` (host configurable via `--host` flag or `OLLAMA_HOST` env var, defaulting to localhost).
- Same `num_ctx: 8192` fix as the Swift app — set it explicitly, don't rely on Ollama's default context window.
- On connection failure, print: "Couldn't reach Ollama at <host>. Run `ollama serve` and make sure the model is pulled (`ollama pull <model>`)." — identical guidance to the Swift app's error message, for consistency.

### `anthropic.js`
- POST to `https://api.anthropic.com/v1/messages`, model `claude-sonnet-4-6`, reading the key from `process.env.ANTHROPIC_API_KEY`.
- If the env var is unset, fail fast with: "Set ANTHROPIC_API_KEY to use the Anthropic backend." — don't let it reach the network call and fail with a raw 401.

### `nim.js`
- POST to `https://integrate.api.nvidia.com/v1/chat/completions` (OpenAI-compatible schema), reading the key from `process.env.NVIDIA_NIM_API_KEY`.
- Same fail-fast pattern as Anthropic if the env var is missing.

## 5. API key handling — do not repeat the Swift app's original mistake
No config file ever stores a raw API key. Keys are read **only** from environment variables. A config file (see Section 6) may store non-secret preferences (default backend, default model) but must never contain a key field — if a user pastes a key into the config file by mistake, the CLI should detect a value that looks like a key pattern (e.g. starts with `sk-ant-` or `nvapi-`) in a non-key field and warn them to move it to an environment variable instead, rather than silently using it from the file.

## 6. Optional config file
`~/.context-transfer/config.json` (created via a `context-transfer config` subcommand, not auto-created) can store:
```json
{ "defaultBackend": "ollama", "defaultModel": "qwen3:8b" }
```
CLI flags always override the config file; the config file overrides built-in defaults. No API keys, ever (see Section 5).

## 7. Output validation
Port the same header-validation logic from the Swift app's Task 4b: after receiving a response from any backend, check for all required section headers before printing. If missing, retry once with a stricter follow-up instruction; if still malformed, print the output anyway with a `⚠️` warning line prepended to stderr (not stdout, so it doesn't corrupt piped output) — e.g. `... | pbcopy` should still get a clean card, with the warning visible in the terminal itself instead.

## 8. CLI interface
```bash
# from clipboard (Mac example)
pbpaste | context-transfer

# from a file
context-transfer --file transcript.txt

# explicit backend + model
context-transfer --backend anthropic --file notes.txt

# JSON output for scripting
context-transfer --file notes.txt --json

# set a persistent default
context-transfer config --set defaultBackend=ollama
```

## 9. Publishing checklist
1. Re-confirm name availability immediately before first publish (`npm view context-transfer` / `npm view context-shifter` — either should currently 404, confirm again since availability can change).
2. `package.json`: set `"bin": { "context-transfer": "./bin/context-transfer.js" }` so `npx context-transfer` resolves correctly.
3. Add a shebang (`#!/usr/bin/env node`) as the first line of `bin/context-transfer.js`.
4. `npm publish` from **inside `/cli`**, not the repo root.
5. Tag releases with the CLI's own version number, independent of the Mac app's version — they're separate artifacts and don't need to stay version-locked to each other.

## 10. Testing checklist
- [ ] `npx context-transfer` works with zero prior global install, against a running local Ollama
- [ ] Missing Ollama connection produces the specific, actionable error message, not a generic network stack trace
- [ ] Missing `ANTHROPIC_API_KEY`/`NVIDIA_NIM_API_KEY` fails fast with a clear message before any network call
- [ ] `--json` output is valid, parseable JSON
- [ ] Output card format matches the Mac app's card format exactly (same headers, same order) for the same input and backend
- [ ] Works on at least one non-Mac OS (Linux or Windows via WSL) end to end
