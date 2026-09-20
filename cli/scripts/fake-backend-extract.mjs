#!/usr/bin/env node
/**
 * Fake-backend extract smoke test (TRD §13 "Pack test").
 *
 * Starts a throwaway HTTP server on 127.0.0.1 that speaks just enough of the
 * Ollama /api/chat dialect to return a canned card (a byte-copy of the shared
 * balanced fixture body, which passes validation), then runs the CLI against
 * it with --offline — loopback counts as local, so this also proves the
 * "zero non-loopback network calls" property end-to-end through the real
 * binary, with no model and no external network.
 *
 * Usage:
 *   node scripts/fake-backend-extract.mjs [--bin <path-to-bin.js>]
 *
 * With no --bin, spawns `context-shifter` from PATH — in CI that is the
 * binary installed from the packed tarball. Exits 0 only if the extraction
 * succeeded (exit 0), the card reached stdout with all six sections, and the
 * content matches what the mock returned.
 *
 * Note: the CLI is spawned ASYNC on purpose — spawnSync would block the
 * event loop and the in-process mock server could never answer.
 */

import http from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const cliRoot = path.dirname(scriptDir);
const repoRoot = path.dirname(cliRoot);

// --bin <path>: spawn `node <path>` instead of the global binary (dev use).
const binArgIdx = process.argv.indexOf('--bin');
const binPath = binArgIdx !== -1 ? process.argv[binArgIdx + 1] : undefined;

const TRANSCRIPT = path.join(repoRoot, 'shared', 'fixtures', 'transcripts', 'short.txt');

// Body of shared/fixtures/cards-valid/balanced-short.md (front matter and
// locally generated "Captured on" removed — normalizeCard injects the stamp).
const CANNED_CARD = `## Goal
- Migrate a ~180-post WordPress blog to Astro.

## Key Decisions
- Staged migration: WordPress export → JSON intermediate → MDX, with a redirect map for changed slugs.
- Importer is Node, outputs JSON first, then MDX; no WP-CLI/PHP anywhere.

## Constraints & Preferences
- No PHP or WP-CLI tooling.
- Permalink structure /%year%/%postname%/ must be preserved to avoid 404s; keep sitemap.xml identical.

## Current State
- Plan agreed; importer design settled (JSON intermediate → MDX).
- Open issue remains: whether draft posts are migrated as drafts or dropped.

## Resources & Links
- https://docs.astro.build/en/guides/content-collections/
- https://giscus.app
- https://github.com/akheron/wordpress-export-to-markdown

## Open Questions
- Draft posts: migrate as drafts or drop them?`;

const SECTIONS = [
  '## Goal',
  '## Key Decisions',
  '## Constraints & Preferences',
  '## Current State',
  '## Resources & Links',
  '## Open Questions',
];

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

if (binArgIdx !== -1 && !binPath) fail('--bin requires a path argument');
if (!fs.existsSync(TRANSCRIPT)) fail(`transcript fixture not found: ${TRANSCRIPT}`);
const transcript = fs.readFileSync(TRANSCRIPT, 'utf8');

/** Spawns the CLI asynchronously with the transcript on stdin. */
function runCli(command, args, input) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', (err) => resolve({ ok: false, status: -1, stdout, stderr, error: err }));
    child.on('close', (status) => resolve({ ok: true, status, stdout, stderr }));
    child.stdin.on('error', () => {
      /* 'close' reports the outcome */
    });
    child.stdin.end(input, 'utf8');
    // Hard safety net so a hung CLI can't wedge CI forever.
    const timer = setTimeout(() => child.kill('SIGKILL'), 60_000);
    timer.unref?.();
  });
}

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    if (req.method !== 'POST' || !req.url?.startsWith('/api/chat')) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'unexpected route' }));
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        model: 'fake-model',
        message: { role: 'assistant', content: CANNED_CARD },
        done: true,
        prompt_eval_count: 400,
        eval_count: 300,
      })
    );
  });
});

server.listen(0, '127.0.0.1', async () => {
  const { port } = server.address();
  const cliArgs = [
    'extract',
    '--host', `http://127.0.0.1:${port}`,
    '--offline',       // loopback is local — must be allowed (TRD §7.4)
    '--quiet',
  ];

  let command, spawnArgs;
  if (binPath) {
    command = process.execPath;
    spawnArgs = [binPath, ...cliArgs];
  } else {
    // `context-shifter.cmd` on Windows (npm shim); plain name elsewhere.
    command = process.platform === 'win32' ? 'context-shifter.cmd' : 'context-shifter';
    spawnArgs = cliArgs;
  }

  try {
    const run = await runCli(command, spawnArgs, transcript);

    if (run.error) fail(`could not spawn "${command}": ${run.error.message}`);
    if (run.status !== 0) {
      fail(`exit code ${run.status}\nstdout: ${run.stdout.slice(0, 400)}\nstderr: ${run.stderr.slice(0, 400)}`);
    }

    const out = run.stdout;
    for (const section of SECTIONS) {
      if (!out.includes(section)) fail(`stdout is missing section "${section}"`);
    }
    if (!/^Captured on: \d{4}-\d{2}-\d{2}$/m.test(out)) {
      fail('stdout is missing the locally generated "Captured on: YYYY-MM-DD" stamp');
    }
    if (!out.includes('Migrate a ~180-post WordPress blog to Astro.')) {
      fail('stdout does not contain the mock card content — the card did not come from the fake backend');
    }
    if (out.includes('<think>')) fail('model chatter (think block) leaked into stdout');

    console.log(`OK: fake-backend extract through "${command}" returned a valid card (${out.length} bytes, exit 0)`);
  } finally {
    server.close();
  }
});
