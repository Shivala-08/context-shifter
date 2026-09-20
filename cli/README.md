# context-shifter (CLI)

Cross-platform command-line companion to the [Context Transfer macOS app](../README.md). Pipe a conversation in, get a structured **context card** out — same template, same sections, same card shape as the Mac app, on any OS with Node 20+.

Zero runtime dependencies. One binary, three backends.

```bash
# install it (or skip this and run ad-hoc with npx)
npm install -g context-shifter

# try it right now, nothing to install
npx context-shifter --help

# the 80% case (macOS)
pbpaste | context-shifter extract --copy

# from a file, tighter card, cloud backend
context-shifter extract transcript.txt --level minimal --backend anthropic
```

Windows PowerShell: `Get-Clipboard | context-shifter extract --copy` · Linux: `xclip -o -selection clipboard | context-shifter extract --copy`

## Install

```bash
npm install -g context-shifter   # global install → context-shifter + cshift binaries
npx context-shifter --help       # or run it ad-hoc, nothing installed
```

Requires **Node.js 20+** (built-in `fetch` and `util.parseArgs`). The short alias `cshift` is installed alongside `context-shifter`.

## Usage

```
context-shifter extract [file|-] [options]
context-shifter doctor
context-shifter models
```

- **stdout is the card, nothing else.** Stats, warnings and progress go to stderr, so `| pbcopy` and `> card.md` stay clean.
- With no file argument, input is read from **stdin**. If stdin is an interactive terminal you'll get a paste prompt (`Ctrl-D` to finish; `Ctrl-Z` then Enter on Windows) instead of a silent hang.

```bash
pbpaste | context-shifter extract | pbcopy          # macOS
pbpaste | context-shifter extract | clip            # Windows
pbpaste | context-shifter extract | wl-copy         # Linux (Wayland)

# guaranteed-local: refuses any non-loopback backend
context-shifter extract chat.txt --offline

# sanity-check the setup
context-shifter doctor
```

### Options

| Flag | Default | Description |
|---|---|---|
| `--backend <name>` | `ollama` | `ollama` · `anthropic` · `nim` |
| `--model <name>` | per backend | Model override |
| `--host <url>` | `OLLAMA_HOST` or `http://127.0.0.1:11434` | Ollama host override |
| `--level <name>` | `balanced` | `full` · `balanced` · `minimal` — same semantics as the Mac app |
| `--copy` | off | Also copy the card to the clipboard (pbcopy / Set-Clipboard / wl-copy / xclip) |
| `--out <file>` | stdout | Also write the card to a file |
| `--offline` | off | Refuse any non-loopback backend — guarantees zero network calls |
| `--ctx <tokens>` | `8192` | Raise the Ollama context window — scales the chunk budget |
| `--max-input <bytes>` | `10485760` | Input size guard |
| `--quiet` | off | Suppress stats/progress on stderr |
| `--no-color` | auto | Accepted for portability; output is plain text either way |
| `--extract` | — | Compat alias for `extract` (the landing page's spelling) |
| `--help`, `-h` / `--version`, `-v` | | |

`--capture` is intentionally **not** implemented — capturing is macOS-app-only (PRD F1).

### Environment variables

| Variable | Used by |
|---|---|
| `OLLAMA_HOST` | Ollama host (default `http://127.0.0.1:11434`) |
| `ANTHROPIC_API_KEY` | Anthropic backend |
| `NVIDIA_API_KEY` | NVIDIA NIM backend (`NVIDIA_NIM_API_KEY` accepted) |
| `NIM_BASE_URL` | NIM endpoint override (default `https://integrate.api.nvidia.com/v1`) |
| `CONTEXT_SHIFTER_BACKEND` / `_MODEL` / `_LEVEL` | Defaults when flags are absent |
| `NO_COLOR` | Colour suppression (output is already plain) |

**API keys are never command-line flags** — they would leak through shell history and `ps`. Env vars only.

### Backends

| Backend | Flag | Key needed | Notes |
|---|---|---|---|
| **Ollama** *(default)* | `--backend ollama` | none | Local, free, private. Needs `ollama serve` running and the model pulled. |
| **Anthropic** | `--backend anthropic` | `ANTHROPIC_API_KEY` | `claude-sonnet-4-6` by default, pay per token |
| **NVIDIA NIM** | `--backend nim` | `NVIDIA_API_KEY` | OpenAI-compatible endpoint, `meta/llama-3.1-8b-instruct` by default |

The Ollama path works with **no API key at all** — the "no cost, no signup" path has to work out of the box:

```bash
ollama serve
ollama pull qwen3:8b
pbpaste | context-shifter extract
```

When a cloud backend is used, one line on stderr names the destination host before anything is sent.

### Long conversations: chunk + merge

Inputs larger than the backend's usable context window are split on turn boundaries, extracted as parts (sequential for local backends, concurrent for cloud), and merged into one final card — later state wins, links are de-duplicated, validation runs on the final card. Raise the local window with `--ctx` if you have the VRAM.

### Validation and malformed output

Same behavior as the Mac app: every card is validated against the shared card spec (`shared/card-spec.md`) — all six sections in order, no empty sections, **every link in Resources & Links must appear verbatim in your input** (hallucination guard), level limits for `minimal`. On failure the CLI retries **once** with the failure reasons; if it still fails, the card is still printed, a warning goes to stderr, and the exit code is 5 — never silently pass a malformed card.

### Exit codes

| Code | Meaning |
|---|---|
| `0` | Success |
| `1` | Unexpected error |
| `2` | Usage error (bad flag, `--offline` with a cloud backend, empty input) |
| `3` | Backend unreachable (Ollama down, timeout) |
| `4` | Auth failure (missing/invalid API key) |
| `5` | Card failed validation after retry (card is still printed) |

### doctor and models

```bash
context-shifter doctor   # Node version, Ollama reachability, model pulled, keys, clipboard tool
context-shifter models   # list locally installed Ollama models
```

`doctor` warns when the configured model is very small (< 8B) — tiny models drop sections and hallucinate links more often.

## How this relates to the macOS app

This CLI is **not** a port of the app — it's the extraction flow in terminal shape. No hotkey capture, no floating panel, no menu bar. What it shares: the exact same extraction prompt and the same card format, so a card made here is interchangeable with one made in the app.

The prompt is the single canonical file [`shared/extraction-prompt.md`](../shared/extraction-prompt.md) at the repo root. The CLI's copy is generated by `scripts/sync-prompt.mjs` and CI fails if it drifts. The card format is a versioned contract (`CARD_SPEC_VERSION`) documented in [`shared/card-spec.md`](../shared/card-spec.md) — see [PRD-CLI](../PRD-CLI.md) / [TRD-CLI](../TRD-CLI.md) for the full design.

## Development

```bash
cd cli
npm install           # dev deps only: typescript + @types/node
npm test              # build + run the unit/contract/fixture tests
npm run sync-prompt   # regenerate prompts/ from ../shared/extraction-prompt.md
npm run check-prompt  # verify no drift (runs in CI)
npm pack --dry-run    # inspect the publishable tarball
```

> **Model tip:** tiny local models (e.g. `llama3.2:3b`) are fast but unreliable for extraction — they drop sections (triggering the ⚠️ warning path) and tend to **hallucinate URLs** in Resources & Links. Prefer ~8B+ models like the default `qwen3:8b`, and always sanity-check links from sub-8B models.

## License

MIT — see [../LICENSE](../LICENSE).
