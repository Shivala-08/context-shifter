/**
 * Claude export parser (PRD R19) — conversations.json from claude.ai's
 * "Export data". Structure (verify when formats change): an array of
 * conversations with an already-chronological `chat_messages` array; each
 * message has `sender` ("human" | "assistant"), a plain `text` field and/or
 * typed `content` blocks.
 */

import { CliError, EXIT } from '../core/errors.js';
import { roleLabel } from './chatgpt-export.js';

export interface ClaudeMessage {
  sender?: string;
  text?: string;
  content?: Array<{ type?: string; text?: string }>;
  created_at?: string;
}

export interface ClaudeConversation {
  uuid?: string;
  name?: string;
  created_at?: string;
  updated_at?: string;
  chat_messages?: ClaudeMessage[];
}

/** Prefers the plain `text` field, falls back to the typed content blocks. */
export function claudeMessageText(message: ClaudeMessage): string {
  if (typeof message.text === 'string' && message.text.trim()) return message.text.trim();
  const blocks = message.content ?? [];
  const lines = blocks
    .filter((b) => (b?.type === 'text' || b?.type === undefined) && typeof b?.text === 'string')
    .map((b) => (b.text ?? '').trim())
    .filter(Boolean);
  return lines.join('\n');
}

export function claudeConversationToTranscript(conversation: ClaudeConversation): string {
  const messages = conversation.chat_messages;
  if (!Array.isArray(messages)) {
    throw new CliError(
      EXIT.USAGE,
      'Not a Claude export: conversation has no "chat_messages" array.',
      'point --from claude-export at the conversations.json file from your Claude data export.'
    );
  }
  const lines: string[] = [];
  for (const message of messages) {
    const sender = message?.sender;
    if (!sender) continue;
    const text = claudeMessageText(message);
    if (!text) continue;
    lines.push(`${roleLabel(sender)}: ${text}`);
  }
  return lines.join('\n\n');
}

export function isClaudeConversation(value: unknown): value is ClaudeConversation {
  return (
    typeof value === 'object' &&
    value !== null &&
    'chat_messages' in value &&
    Array.isArray((value as ClaudeConversation).chat_messages)
  );
}
