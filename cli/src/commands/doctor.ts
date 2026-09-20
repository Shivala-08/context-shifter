/**
 * `doctor` (PRD R22) — pass/fail the setup: Node version, Ollama
 * reachability, model presence (with a small-model warning), cloud keys,
 * clipboard tool. Exit 1 when a hard check fails.
 */

import { EXIT } from '../core/errors.js';
import { resolveClipboardCommand } from '../io/clipboard.js';
import { listOllamaModels, DEFAULT_MODEL } from '../backends/ollama.js';

type Status = 'pass' | 'warn' | 'fail';

interface Check {
  status: Status;
  name: string;
  detail: string;
}

/** "qwen3:8b" → 8. Tiny models fail validation more often (PRD §11). */
function modelSizeB(model: string): number | undefined {
  const m = /(\d+(?:\.\d+)?)\s*b\b/i.exec(model);
  return m ? Number(m[1]) : undefined;
}

export async function runDoctor(): Promise<number> {
  const checks: Check[] = [];

  // Node version
  const major = Number(process.versions.node.split('.')[0]);
  checks.push(
    major >= 20
      ? { status: 'pass', name: 'Node.js', detail: process.versions.node }
      : { status: 'fail', name: 'Node.js', detail: `${process.versions.node} — context-shifter requires Node >= 20` }
  );

  // Ollama reachability + model presence
  let models: Array<{ name: string; size?: number }> = [];
  try {
    models = await listOllamaModels();
    checks.push({ status: 'pass', name: 'Ollama', detail: `reachable, ${models.length} model(s) installed` });
    const model = process.env.OLLAMA_MODEL || DEFAULT_MODEL;
    if (models.some((m) => m.name === model || m.name.startsWith(model + ':') || model.startsWith(m.name))) {
      checks.push({ status: 'pass', name: `Model (${model})`, detail: 'pulled' });
    } else {
      checks.push({
        status: 'fail',
        name: `Model (${model})`,
        detail: `not pulled — run: ollama pull ${model}`,
      });
    }
    const size = modelSizeB(model);
    if (size !== undefined && size < 8) {
      checks.push({
        status: 'warn',
        name: `Model size (${model})`,
        detail: `${size}B models drop sections and hallucinate links more often — prefer ~8B+`,
      });
    }
  } catch {
    checks.push({ status: 'fail', name: 'Ollama', detail: 'not reachable — start it with: ollama serve' });
  }

  // Cloud keys (informational — the local path needs none)
  const cloudKeys: Array<{ name: string; envs: string[]; backend: string }> = [
    { name: 'Anthropic key', envs: ['ANTHROPIC_API_KEY'], backend: 'anthropic' },
    { name: 'NVIDIA key', envs: ['NVIDIA_API_KEY', 'NVIDIA_NIM_API_KEY'], backend: 'nim' },
    { name: 'OpenAI key', envs: ['OPENAI_API_KEY'], backend: 'openai' },
    { name: 'OpenRouter key', envs: ['OPENROUTER_API_KEY'], backend: 'openrouter' },
  ];
  for (const { name, envs, backend } of cloudKeys) {
    const value = envs.map((e) => (process.env[e] || '').trim()).find(Boolean);
    checks.push(
      value
        ? { status: 'pass', name, detail: `${envs[0]} is set` }
        : { status: 'warn', name, detail: `${envs[0]} not set (only needed for --backend ${backend})` }
    );
  }

  // Clipboard tool
  const clip = resolveClipboardCommand();
  checks.push(
    clip
      ? { status: 'pass', name: 'Clipboard', detail: clip.label }
      : { status: 'warn', name: 'Clipboard', detail: 'no clipboard tool found — install xclip or wl-copy' }
  );

  const glyphs: Record<Status, string> = { pass: '✓', warn: '!', fail: '✗' };
  for (const c of checks) {
    process.stdout.write(`${glyphs[c.status]} ${c.name.padEnd(22)} ${c.detail}\n`);
  }

  const failed = checks.some((c) => c.status === 'fail');
  process.stdout.write(failed ? '\nSetup has problems — fix the ✗ items above.\n' : '\nAll hard checks passed.\n');
  return failed ? EXIT.UNEXPECTED : EXIT.OK;
}
