/**
 * ChatGPT export parser (PRD R19) — conversations.json from the official
 * "Export data" archive. Structure (verify when formats change): an array of
 * conversations, each with a node graph `mapping` and a `current_node` id.
 * The message tree is walked from `current_node` back to the root via parent
 * links, then reversed into chronological order — this matches the visible
 * conversation, including edited/regenerated branches.
 */

import { CliError, EXIT } from '../core/errors.js';

export interface ChatGptNode {
  id?: string;
  parent?: string | null;
  message?: {
    author?: { role?: string };
    content?: { content_type?: string; parts?: unknown[] };
  } | null;
}

export interface ChatGptConversation {
  title?: string;
  create_time?: number;
  update_time?: number;
  current_node?: string;
  mapping?: Record<string, ChatGptNode>;
}

export function roleLabel(role: string): string {
  switch (role) {
    case 'user':
    case 'human': // Claude exports use "human" — normalise to the same label
      return 'User';
    case 'assistant':
      return 'Assistant';
    case 'tool':
      return 'Tool';
    default:
      return role.charAt(0).toUpperCase() + role.slice(1);
  }
}

/** Extracts the text of one message's content; empty when nothing readable. */
export function chatGptMessageText(message: NonNullable<ChatGptNode['message']>): string {
  const parts = message.content?.parts ?? [];
  const lines: string[] = [];
  for (const part of parts) {
    if (typeof part === 'string') lines.push(part);
    else lines.push('[non-text part]'); // images, files, audio pointers, …
  }
  return lines.join('\n').trim();
}

/** Walks current_node → root, reverses, and renders "Role: text" lines. */
export function chatGptConversationToTranscript(conversation: ChatGptConversation): string {
  const mapping = conversation.mapping;
  if (!mapping || typeof mapping !== 'object') {
    throw new CliError(
      EXIT.USAGE,
      'Not a ChatGPT export: conversation has no message "mapping".',
      'point --from chatgpt-export at the conversations.json file from your ChatGPT data export.'
    );
  }
  const currentNode = conversation.current_node;
  if (typeof currentNode !== 'string' || !mapping[currentNode]) {
    throw new CliError(
      EXIT.USAGE,
      'Not a usable ChatGPT export: "current_node" is missing or not in the message mapping.',
      're-export your ChatGPT data and use the conversations.json file.'
    );
  }

  // Climb parent links to the root, then walk the collected chain backwards.
  const chain: string[] = [];
  let cursor: string | null | undefined = currentNode;
  const seen = new Set<string>();
  while (typeof cursor === 'string' && mapping[cursor] && !seen.has(cursor)) {
    seen.add(cursor);
    chain.push(cursor);
    cursor = mapping[cursor]?.parent ?? null;
  }
  chain.reverse();

  const lines: string[] = [];
  for (const id of chain) {
    const message = mapping[id]?.message;
    if (!message) continue; // root/placeholder nodes carry no message
    const role = message.author?.role;
    if (!role || role === 'system') continue; // hidden platform prompts are noise
    const text = chatGptMessageText(message);
    if (!text) continue;
    lines.push(`${roleLabel(role)}: ${text}`);
  }
  return lines.join('\n\n');
}

/** True when the object looks like one ChatGPT conversation (has a mapping). */
export function isChatGptConversation(value: unknown): value is ChatGptConversation {
  return (
    typeof value === 'object' &&
    value !== null &&
    'mapping' in value &&
    typeof (value as ChatGptConversation).mapping === 'object'
  );
}
