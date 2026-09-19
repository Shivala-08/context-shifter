# context-transfer (CLI)

Cross-platform command-line companion to the [Context Transfer macOS app](../README.md). Pipe a conversation in, get a structured **context card** out — same template, same sections, same card shape as the Mac app, on any OS with Node 18+.

Zero runtime dependencies. One binary, three backends.

```bash
# try it right now, nothing to install
npx context-transfer --help

# from the clipboard (macOS)
pbpaste | npx context-transfer

# from a file
npx context-transfer --file transcript.txt
```

## Install

Nothing to install — `npx context-transfer` fetches and runs it on demand. If you'd rather have it on your PATH:

```bash
npm install -g context-transfer
```

Requires **Node.js 18+** (native `fetch`).

## Usage

```bash
# from the clipboard (macOS / Windows PowerShell: Get-Clipboard |, Linux: xclip -o |)
pbpaste | context-transfer

# from a file
context-transfer --file transcript.txt

# explicit backend + model
context-transfer --backend anthropic --file notes.txt

# JSON output for scripting
context-transfer --file notes.txt --json

# point at a remote Ollama host
context-transfer --host http://gpu-box.local:11434

# set a persistent default
context-transfer config --set defaultBackend=ollama
```

The card is printed to **stdout**, warnings and errors to **stderr**, so it composes cleanly with pipelines:

```bash
pbpaste | context-transfer | pbcopy     # macOS
pbpaste | context-transfer | clip       # Windows
pbpaste | context-transfer | wl-copy    # Linux (Wayland)
```

### Backends

| Backend | Flag | Key needed | Notes |
|---|---|---|---|
| **Ollama** *(default)* | `--backend ollama` | none | Local, free, private. Needs `ollama serve` running and the model pulled. |
| **Anthropic** | `--backend anthropic` | `ANTHROPIC_API_KEY` | `claude-sonnet-4-6`, pay per token |
| **NVIDIA NIM** | `--backend nim` | `NVIDIA_NIM_API_KEY` | OpenAI-compatible endpoint, `meta/llama-3.1-8b-instruct` by default |

The Ollama path works with **no API key at all** — the "no cost, no signup" path has to work out of the box:

```bash
ollama serve
ollama pull qwen3:8b
pbpaste | context-transfer
```

If Ollama isn't reachable you'll get a specific, actionable message — never a stack trace:

```
Error: Couldn't reach Ollama at http://localhost:11434. Run `ollama serve` and make sure
the model is pulled (`ollama pull qwen3:8b`). (ECONNREFUSED)
```

### JSON output

`--json` swaps the markdown card for structured output for scripting:

```json
{
  "backend": "ollama",
  "capturedOn": "2026-09-19",
  "card": "Captured on: 2026-09-19\n\n## Goal\n- ...",
  "formatValid": true,
  "warnings": []
}
```

### Config file (optional)

```bash
context-transfer config                       # show current config
context-transfer config --set defaultBackend=ollama
context-transfer config --set defaultModel=qwen3:8b
```

Stored at `~/.context-transfer/config.json`:

```json
{ "defaultBackend": "ollama", "defaultModel": "qwen3:8b" }
```

Precedence: **CLI flags > config file > built-in defaults**.

> **API keys are never stored in the config file.** Keys live only in the `ANTHROPIC_API_KEY` / `NVIDIA_NIM_API_KEY` environment variables. If you paste a key into the config by mistake, the CLI detects the pattern (`sk-ant-…`, `nvapi-…`), refuses to use it, and tells you to move it to an env var.

### Flags reference

| Flag | Description |
|---|---|
| `--file <path>` | Read the conversation from a file instead of stdin |
| `--backend <name>` | `ollama` (default) · `anthropic` · `nim` |
| `--model <name>` | Model override |
| `--host <url>` | Ollama host override (falls back to `OLLAMA_HOST`) |
| `--json` | Structured JSON output instead of the markdown card |
| `--help`, `-h` | Help |
| `--version`, `-v` | Version |

### Environment variables

| Variable | Used by |
|---|---|
| `OLLAMA_HOST` | Ollama host (default `http://localhost:11434`) |
| `ANTHROPIC_API_KEY` | Anthropic backend |
| `NVIDIA_NIM_API_KEY` | NVIDIA NIM backend |

### Malformed output handling

Same behavior as the Mac app: every response is validated against the required card headers. If a section is missing, the CLI retries once with a stricter instruction; if the retry is also malformed, the card is still printed (stdout stays clean for piping), with a `⚠️` warning on **stderr**.

### How this relates to the macOS app

This CLI is **not** a port of the app — it's the Phase 1 extraction flow in terminal shape. No hotkey capture, no floating panel, no menu bar. What it shares: the exact same extraction template and the same card format, so a card made here is interchangeable with one made in the app. The template lives in one canonical file (`/prompt/extraction-template.md`) that both codebases draw from, and CI fails if the CLI copy drifts — see [PRD §8](../PRD_cli.md) for the drift rationale.

## Development

```bash
cd cli
npm test              # unit tests (node:test, zero dev deps)
npm run sync-prompt   # regenerate src/prompt.js from /prompt/extraction-template.md
npm run check-prompt  # verify no drift (runs in CI)
```

## License

MIT — see [../LICENSE](../LICENSE).
