/**
 * Export-format dispatch (PRD R19). Both official exports ship a
 * conversations.json holding MANY conversations; this CLI converts one
 * conversation per run, so an array input picks the most recently updated
 * one and says so on stderr (via returned warnings).
 */

import { CliError, EXIT } from '../core/errors.js';
import { isChatGptConversation, chatGptConversationToTranscript, type ChatGptConversation } from './chatgpt-export.js';
import { isClaudeConversation, claudeConversationToTranscript, type ClaudeConversation } from './claude-export.js';

export const EXPORT_FORMATS = ['chatgpt-export', 'claude-export'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export function isExportFormat(value: string): value is ExportFormat {
  return (EXPORT_FORMATS as readonly string[]).includes(value);
}

export interface ParseExportResult {
  transcript: string;
  warnings: string[];
}

/** Most-recent-first comparison across epoch-seconds and ISO timestamps. */
function recency(value: number | string | undefined): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed / 1000;
  }
  return 0;
}

function pickLatest<T>(items: T[], updatedAt: (item: T) => number | string | undefined): { item: T; index: number } {
  // Callers guarantee a non-empty list (empty exports throw before this).
  if (items.length === 0) throw new CliError(EXIT.USAGE, 'No conversations to pick from.');
  let best = 0;
  for (let i = 1; i < items.length; i++) {
    const candidate = items[i];
    const current = items[best];
    if (candidate !== undefined && current !== undefined && recency(updatedAt(candidate)) > recency(updatedAt(current))) {
      best = i;
    }
  }
  return { item: items[best] as T, index: best };
}

export function parseExport(format: ExportFormat, rawText: string): ParseExportResult {
  let data: unknown;
  try {
    data = JSON.parse(rawText);
  } catch {
    throw new CliError(
      EXIT.USAGE,
      `--from ${format} expects JSON, but the input is not valid JSON.`,
      format === 'chatgpt-export'
        ? 'point it at the conversations.json file from your ChatGPT data export.'
        : 'point it at the conversations.json file from your Claude data export.'
    );
  }
  const warnings: string[] = [];

  if (format === 'chatgpt-export') {
    if (Array.isArray(data)) {
      if (data.length === 0) {
        throw new CliError(EXIT.USAGE, 'The ChatGPT export contains no conversations.');
      }
      const conversations = data.filter(isChatGptConversation);
      if (conversations.length === 0) {
        throw new CliError(EXIT.USAGE, 'The ChatGPT export has no conversations with a message "mapping".');
      }
      if (conversations.length > 1) {
        warnings.push(
          `the export contains ${conversations.length} conversations — converting the most recently updated one; split the file to convert others.`
        );
      }
      const { item } = pickLatest(conversations, (c) => c.update_time ?? c.create_time);
      return { transcript: chatGptConversationToTranscript(item), warnings };
    }
    if (isChatGptConversation(data)) {
      return { transcript: chatGptConversationToTranscript(data), warnings };
    }
    throw new CliError(
      EXIT.USAGE,
      'Not a ChatGPT export: expected a conversation with a "mapping" (or an array of them).',
      'point --from chatgpt-export at the conversations.json file from your ChatGPT data export.'
    );
  }

  // claude-export
  if (Array.isArray(data)) {
    if (data.length === 0) {
      throw new CliError(EXIT.USAGE, 'The Claude export contains no conversations.');
    }
    const conversations = data.filter(isClaudeConversation);
    if (conversations.length === 0) {
      throw new CliError(EXIT.USAGE, 'The Claude export has no conversations with a "chat_messages" array.');
    }
    if (conversations.length > 1) {
      warnings.push(
        `the export contains ${conversations.length} conversations — converting the most recently updated one; split the file to convert others.`
      );
    }
    const { item } = pickLatest(conversations, (c) => c.updated_at ?? c.created_at);
    return { transcript: claudeConversationToTranscript(item), warnings };
  }
  if (isClaudeConversation(data)) {
    return { transcript: claudeConversationToTranscript(data), warnings };
  }
  throw new CliError(
    EXIT.USAGE,
    'Not a Claude export: expected a conversation with "chat_messages" (or an array of them).',
    'point --from claude-export at the conversations.json file from your Claude data export.'
  );
}
