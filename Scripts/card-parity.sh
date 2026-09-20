#!/bin/bash
#
# card-parity.sh — structural parity check between the macOS app's extraction
# path and the Node CLI (TRD checklist: "Output card format matches the Mac
# app's card format exactly — same headers, same order").
#
# What it does:
#   1. Compiles a temporary Swift driver against the app's real extraction
#      code (OllamaBackend + Task 4b validation) — no XCTest needed, works
#      with CommandLineTools alone.
#   2. Runs BOTH tools on the byte-identical conversation against the same
#      Ollama host and model.
#   3. Compares the two cards structurally: header set + order, client-side
#      "Captured on:" stamp, no fences/preamble, bullet consistency.
#
# Prose will differ between runs (separate LLM generations) — this script
# only asserts what the PRD promises: identical structure.
#
# Usage:
#   Scripts/card-parity.sh [model] [host]
#     model  Ollama model to use on both sides (default: qwen3:8b — must be
#            pulled already; llama3.2:3b works but is prone to link
#            hallucination and dropped sections)
#     host   Ollama host (default: http://localhost:11434)
#
# Exit 0 = structural parity PASS. On failure the work dir is kept and its
# path printed for debugging.

set -euo pipefail

MODEL="${1:-qwen3:8b}"
HOST="${2:-http://localhost:11434}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d /tmp/card-parity.XXXXXX)"

cleanup() {
  if [ $? -ne 0 ]; then
    echo ""
    echo "FAILED — artifacts kept at $WORK for inspection."
  else
    rm -rf "$WORK"
  fi
}
trap cleanup EXIT

# ---------- preflight ----------

command -v swiftc >/dev/null 2>&1 || { echo "error: swiftc not found (install Swift / Xcode CLIs)"; exit 2; }
command -v node   >/dev/null 2>&1 || { echo "error: node not found (Node 18+ required)"; exit 2; }
curl -sf --max-time 3 "$HOST/api/tags" >/dev/null 2>&1 \
  || { echo "error: Ollama not reachable at $HOST — run \`ollama serve\` and pull the model (\`ollama pull $MODEL\`)"; exit 2; }

echo "Card parity check — model: $MODEL · host: $HOST"

# ---------- Swift driver (temporary, compiled against app sources) ----------

cat > "$WORK/parity-shim.swift" <<'SWIFT_SHIM_EOF'
import Foundation

// Temporary parity shim: the two ContentView-defined types that
// OllamaBackend.warmUpInBackground references, so the driver compiles
// without dragging SwiftUI in.
enum BackendType: String {
    case local
    case cloud
}

enum SettingsKeys {
    static let backendType = "backendType"
    static let ollamaHost = "ollamaHost"
    static let ollamaModel = "ollamaModel"
}
SWIFT_SHIM_EOF

cat > "$WORK/parity-driver.swift" <<'SWIFT_DRIVER_EOF'
import Foundation

// Temporary parity driver: runs the app's REAL extraction path
// (OllamaBackend + Task 4b validation) on a fixed conversation and writes
// the card + the exact input to the given directory. Not part of the app.

@main
struct ParityDriver {
    static let conversation = """
    Conversation with Claude about migrating a blog from WordPress to Astro:

    User: I'm planning to move my blog off WordPress to Astro. The current site has about 180 posts, mostly markdown-ish HTML with shortcodes. What's the plan?

    Claude: Key points to settle first:
    1. Frontmatter mapping — WordPress export gives you wp:postmeta; you'll map title/date/slug/categories into Astro's content collections schema.
    2. Shortcode handling — you use [gallery] and [caption] shortcodes; decide between rehype-transform or a prebuild script to convert them to MDX components.
    3. URL preservation — your permalink structure is /%year%/%postname%/, so configure Astro's build.format and trailingSlash to avoid 404s; keep sitemap.xml identical.
    4. Images — WordPress media lives in wp-content/uploads; either keep hotlinking during transition or download and rewrite with a remark plugin.
    5. Comments — moving to giscus on GitHub Discussions.

    User: The importer script should be Node, output JSON first, then MDX.

    Claude: Agreed — staged migration: WordPress export -> JSON intermediate -> MDX. Redirect map for changed slugs. Validate with a link checker before DNS cutover. Open issue: whether draft posts should be migrated as drafts or dropped.
    """

    static func main() async throws {
        let args = CommandLine.arguments
        guard args.count >= 3 else {
            FileHandle.standardError.write(Data("usage: parity-driver <model> <outdir> [host]\n".utf8))
            exit(2)
        }
        let model = args[1]
        let dir = args[2]
        let host = args.count >= 4 ? args[3] : OllamaBackend.defaultHost

        try FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
        try conversation.write(toFile: dir + "/input.txt", atomically: true, encoding: .utf8)

        let backend = OllamaBackend(host: host, model: model)
        let (card, stats) = try await backend.extractContext(from: conversation, level: .balanced)

        try card.write(toFile: dir + "/swift-card.md", atomically: true, encoding: .utf8)
        print("swift side: \(card.count) chars · \(stats.summary)")
    }
}
SWIFT_DRIVER_EOF

# Compile the app's real extraction sources. If OllamaBackend gains new
# in-repo dependencies, add them to this list.
echo "→ compiling Swift driver…"
swiftc -parse-as-library -o "$WORK/parity-driver" \
  "$WORK/parity-driver.swift" "$WORK/parity-shim.swift" \
  "$ROOT/Sources/ContextTransfer/ExtractionBackend.swift" \
  "$ROOT/Sources/ContextTransfer/OllamaBackend.swift" \
  "$ROOT/Sources/ContextTransfer/AnthropicBackend.swift" \
  "$ROOT/Sources/ContextTransfer/KeychainHelper.swift"

echo "→ running Swift extraction…"
"$WORK/parity-driver" "$MODEL" "$WORK" "$HOST"

# ---------- CLI run on byte-identical input ----------

echo "→ running CLI extraction…"
node "$ROOT/cli/bin/context-transfer.js" \
  --model "$MODEL" --host "$HOST" \
  --file "$WORK/input.txt" --json > "$WORK/cli-card.json"

# ---------- structural comparison ----------

node - "$WORK/swift-card.md" "$WORK/cli-card.json" <<'COMPARE_EOF'
'use strict';
const fs = require('fs');

const swift = fs.readFileSync(process.argv[2], 'utf8');
const cliJson = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
const cli = cliJson.card;

const HEADERS = [
  'Captured on:',
  '## Goal',
  '## Key Decisions',
  '## Constraints & Preferences',
  '## Current State',
  '## Resources & Links',
  '## Open Questions',
];

const headerSet = (t) => HEADERS.filter((h) => t.includes(h));
const headerOrder = (t) => {
  let last = -1;
  for (const h of HEADERS) {
    const i = t.indexOf(h);
    if (i !== -1) {
      if (i < last) return false;
      last = i;
    }
  }
  return true;
};
const stampDate = (t) => (t.match(/^Captured on: (\d{4}-\d{2}-\d{2})/) || [])[1] || null;
const firstBullet = (t) => {
  const line = t.split('\n').find((l) => /^[*-] /.test(l));
  return line ? line[0] : null;
};

const checks = [
  ['header set identical', JSON.stringify(headerSet(swift)) === JSON.stringify(headerSet(cli))],
  ['header order identical', headerOrder(swift) && headerOrder(cli)],
  ['both start with Captured on:', !!stampDate(swift) && !!stampDate(cli)],
  ['same capture date', stampDate(swift) === stampDate(cli)],
  ['no leading fence/preamble', !swift.startsWith('```') && !cli.startsWith('```')],
  ['no <think> leakage', !swift.includes('<think>') && !cli.includes('<think>')],
  ['both non-empty', swift.trim().length > 0 && cli.trim().length > 0],
];

let pass = true;
for (const [name, ok] of checks) {
  console.log((ok ? '✓' : '✗') + ' ' + name);
  if (!ok) pass = false;
}

// Non-fatal observations
const swValid = headerSet(swift).length === HEADERS.length;
const cliValid = cliJson.formatValid === true;
if (!swValid || !cliValid) {
  console.log('⚠️  flagged card: swift formatValid=' + swValid + ', cli formatValid=' + cliValid +
    ' (Task 4b retry/warn path — noisy small models, not a parity failure)');
}
const swBullet = firstBullet(swift);
const cliBullet = firstBullet(cli);
if (swBullet && cliBullet && swBullet !== cliBullet) {
  console.log('⚠️  bullet glyph differs: swift uses "' + swBullet + '", cli uses "' + cliBullet + '"');
}

console.log('');
console.log('swift: ' + swift.length + ' chars · cli: ' + cli.length + ' chars');
console.log(pass ? 'STRUCTURAL PARITY: PASS' : 'STRUCTURAL PARITY: FAIL');
process.exit(pass ? 0 : 1);
COMPARE_EOF

echo ""
echo "Parity check complete."
