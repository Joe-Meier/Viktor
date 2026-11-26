import { DEFAULT_LEVEL } from "./escalation";
import { turnNumber } from "./prompt";
import { mergeRegistry } from "./registry";
import { emptyRegistry, type Draft, type LevelId, type Message, type RegistryUpdate, type Thread } from "./types";

const uid = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** Best-effort sender name from a pasted email: a "From:" header or the sign-off. */
export function guessSender(body: string): string {
  const from = body.match(/^\s*from:\s*([^<\n]+?)\s*(?:<[^>]*>)?\s*$/im);
  if (from) return from[1].replace(/["']/g, "").trim();
  const lines = body.trim().split(/\n/).map((l) => l.trim()).filter(Boolean);
  const signoff = lines.findIndex((l) => /^(best|thanks|cheers|regards|best regards|kind regards|warm regards|sincerely|all the best|thank you)[,.!]?$/i.test(l));
  if (signoff !== -1 && lines[signoff + 1] && lines[signoff + 1].length <= 40) return lines[signoff + 1];
  return "";
}

export function guessSubject(body: string): string {
  const m = body.match(/^\s*subject:\s*(.+)$/im);
  return m ? m[1].trim() : "";
}

export interface NewThreadInput {
  body: string;
  senderName?: string;
  subject?: string;
  level?: LevelId;
}

export function createThread(input: NewThreadInput, now = new Date()): Thread {
  const body = input.body.trim();
  const sender = input.senderName?.trim() || guessSender(body) || "Salesperson";
  const subject = input.subject?.trim() || guessSubject(body) || "(no subject)";
  const ts = now.toISOString();
  return {
    id: uid("thread"),
    title: sender,
    subject,
    counterparty: sender,
    isSample: false,
    level: input.level ?? DEFAULT_LEVEL,
    messages: [{ id: uid("m"), from: "them", senderName: sender, body, createdAt: ts }],
    registry: emptyRegistry(),
    draft: null,
    createdAt: ts,
    updatedAt: ts,
  };
}

export function setDraft(thread: Thread, text: string, update: RegistryUpdate, level: LevelId, now = new Date()): Thread {
  const draft: Draft = { text, update, level, createdAt: now.toISOString() };
  return { ...thread, draft, updatedAt: now.toISOString() };
}

/**
 * The user sent the draft (outside this app). It joins the thread as their message and
 * its registry changes become canon.
 */
export function commitDraft(thread: Thread, now = new Date()): Thread {
  if (!thread.draft || !thread.draft.text.trim()) return thread;
  const turn = turnNumber(thread.messages);
  const message: Message = {
    id: uid("m"),
    from: "me",
    senderName: "You",
    body: thread.draft.text.trim(),
    createdAt: now.toISOString(),
  };
  return {
    ...thread,
    messages: [...thread.messages, message],
    registry: mergeRegistry(thread.registry, thread.draft.update, turn),
    draft: null,
    updatedAt: now.toISOString(),
  };
}

/** Paste the salesperson's follow-up. A pending draft is assumed sent first. */
export function addTheirReply(thread: Thread, body: string, now = new Date()): Thread {
  const text = body.trim();
  if (!text) return thread;
  const base = thread.draft?.text.trim() ? commitDraft(thread, now) : { ...thread, draft: null };
  const message: Message = {
    id: uid("m"),
    from: "them",
    senderName: thread.counterparty,
    body: text,
    createdAt: now.toISOString(),
  };
  return { ...base, messages: [...base.messages, message], updatedAt: now.toISOString() };
}

/** Registry as it will look once the current draft is sent. */
export function previewRegistry(thread: Thread) {
  if (!thread.draft) return thread.registry;
  return mergeRegistry(thread.registry, thread.draft.update, turnNumber(thread.messages));
}
