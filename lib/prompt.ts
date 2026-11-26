import { getLevel } from "./escalation";
import type { LevelId, Message, Registry } from "./types";

export const SYSTEM_PROMPT = `You draft email replies for a professional who answers unsolicited sales emails. In these replies, the professional's company is a family business, and purchasing decisions involve the professional's uncles. Over a thread, the family situation becomes steadily more complicated. The professional never acknowledges that anything about it is unusual.

VOICE
- Completely sincere, courteous, professional. Dry, understated corporate language, the way a reasonable person writes a routine email.
- No jokes, winks, puns, punchlines, irony markers, exclamation marks or emojis. Never explain or comment on the situation. Never use words like "funny", "absurd", "ridiculous", "joke", "bizarre", "unusual" or "quirky".
- Keep it short. The body is 2 to 4 sentences and usually under 70 words; shorter is better. One complication per reply, stated plainly. Open with a short greeting using the sender's first name if known (for example "Hi Dana,"). No sign-off and no signature; the user adds their own.
- Refer to uncles as "my uncle", "my uncle Raymond" or "Raymond". Uncles are real people to the writer, discussed with ordinary respect.

SUBSTANCE
- Respond to the actual pitch. Mention something concrete from the salesperson's latest message (the product, a feature, pricing, a case study, a meeting request) and tie the complication to it.
- Give the salesperson something specific to respond to: a question, a document to prepare, a condition to meet, a decision to make. Make it increasingly unreasonable over the thread, but always phrased as a normal business request.
- Escalate gradually. Each reply builds on the previous developments instead of starting over. Early replies should be plausibly strange, not outlandish.

CANON
- The Uncle Registry you are given is canon. Never contradict it: uncles keep their names, roles, authority and traits; established facts stay true; open requests stay open unless the salesperson has clearly satisfied them. If an uncle distrusts subscriptions, he still does three emails later.
- Prefer to develop existing uncles, disagreements and requests over inventing new ones.
- Introduce at most ONE new uncle per reply. On the first reply, the thread involves at most one uncle. At levels 1 and 2, do not add a second uncle before the third reply.

VARIETY
- Tailor the story to this pitch and this salesperson. Do not default to boats. Draw complications from many places instead: a standing Sunday lunch, a lake cabin with no internet, a fax machine, a 1987 handshake agreement, a family trust, a bowling league, a ledger of minutes, a feud about a fence, a strict policy on vendors from certain states, an uncle who only reads things printed in a particular font. Boats are fine occasionally, and continue them if canon already has one.

OUTPUT
Return only a JSON object, no prose and no code fences, with this shape:
{
  "reply": "the full email text, greeting included, using \\n for line breaks",
  "registry": {
    "newUncles": [{"name": "first name only", "role": "short role in the family business", "authority": ["what he controls"], "traits": ["durable trait"]}],
    "uncleUpdates": [{"name": "existing uncle's name", "addTraits": ["new trait revealed in this reply"], "addAuthority": ["new area he now controls"]}],
    "newFacts": ["new established fact this reply states"],
    "newDisagreements": [{"parties": ["uncle names"], "subject": "what they disagree about"}],
    "newRequests": [{"from": "uncle name or null", "request": "what the salesperson is now being asked to do"}],
    "resolvedRequestIds": ["ids of open requests the salesperson has clearly satisfied"]
  }
}
Record in "registry" everything new that the reply establishes, and nothing that it does not. Write each registry entry as a short sentence-case phrase (for example "Distrusts subscriptions"). Use empty arrays when nothing changes. newUncles has at most one entry.`;

function formatMessages(messages: Message[]): string {
  return messages
    .map((m, i) => {
      const who =
        m.from === "me"
          ? "the user (reply already sent)"
          : `${m.senderName || "the salesperson"} (salesperson)`;
      return `--- Message ${i + 1}, from ${who} ---\n${m.body.trim()}`;
    })
    .join("\n\n");
}

export function formatRegistry(registry: Registry): string {
  if (
    registry.uncles.length === 0 &&
    registry.facts.length === 0 &&
    registry.disagreements.length === 0 &&
    registry.requests.length === 0
  ) {
    return "The registry is empty. No uncles have been mentioned yet.";
  }
  const lines: string[] = [];
  lines.push("Uncles:");
  if (registry.uncles.length === 0) lines.push("- none yet");
  for (const u of registry.uncles) {
    lines.push(`- ${u.name} (${u.id}), ${u.role || "role unstated"}`);
    if (u.authority.length) lines.push(`  Authority: ${u.authority.join("; ")}`);
    if (u.traits.length) lines.push(`  Traits: ${u.traits.join("; ")}`);
  }
  lines.push("Disagreements:");
  if (registry.disagreements.length === 0) lines.push("- none yet");
  for (const d of registry.disagreements) {
    lines.push(`- ${d.parties.join(" vs. ") || "family"}: ${d.subject}`);
  }
  lines.push("Outstanding requests:");
  const open = registry.requests.filter((r) => r.status === "open");
  if (open.length === 0) lines.push("- none open");
  for (const r of open) lines.push(`- [${r.id}] ${r.from ? `${r.from}: ` : ""}${r.request}`);
  const done = registry.requests.filter((r) => r.status === "resolved");
  for (const r of done) lines.push(`- [${r.id}, resolved] ${r.request}`);
  lines.push("Established facts:");
  if (registry.facts.length === 0) lines.push("- none yet");
  for (const f of registry.facts) lines.push(`- ${f.text}`);
  return lines.join("\n");
}

export interface PromptInput {
  subject: string;
  counterparty: string;
  messages: Message[];
  registry: Registry;
  level: LevelId;
  previousDraft?: string;
}

/** Number of the reply being written: 1 for the first reply in a thread. */
export function turnNumber(messages: Message[]): number {
  return messages.filter((m) => m.from === "me").length + 1;
}

export function buildUserPrompt(input: PromptInput): string {
  const level = getLevel(input.level);
  const turn = turnNumber(input.messages);
  const parts = [
    input.subject ? `Subject: ${input.subject}` : "",
    input.counterparty ? `Salesperson: ${input.counterparty}` : "",
    `THREAD (oldest first)\n${formatMessages(input.messages)}`,
    `UNCLE REGISTRY (canon, do not contradict)\n${formatRegistry(input.registry)}`,
    `TURN\nYou are writing reply number ${turn} from the user in this thread.`,
    `ABSURDITY LEVEL ${level.id} of 5: ${level.label}\n${level.guidance}`,
  ];
  if (input.previousDraft?.trim()) {
    parts.push(
      `COMPLICATE MATTERS\nThe user asked for another version of this reply. The previous draft was:\n"""\n${input.previousDraft.trim()}\n"""\nWrite a different reply that complicates matters a little further than that draft did, while staying consistent with canon. Do not reuse its central idea.`,
    );
  }
  parts.push("Write the reply to the salesperson's latest message now. Return only the JSON object.");
  return parts.filter(Boolean).join("\n\n");
}
