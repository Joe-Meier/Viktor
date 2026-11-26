import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { LEVELS } from "@/lib/escalation";
import { parseModelOutput } from "@/lib/generate";
import { buildUserPrompt, formatRegistry, SYSTEM_PROMPT, turnNumber } from "@/lib/prompt";
import { mergeRegistry, statusLine } from "@/lib/registry";
import { createSampleThread } from "@/lib/sample";
import { emptyRegistry, emptyUpdate, type RegistryUpdate } from "@/lib/types";
import {
  buttons,
  cardOf,
  cardText,
  click,
  event,
  FakeProperties,
  fakeGmail,
  formOf,
  loadAddon,
  notificationOf,
  walk,
} from "../gmail-addon/dev/harness.mjs";

const ADDON = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "gmail-addon");
const ME = "joe@joemeier.cool";
const plain = <T>(x: T): T => JSON.parse(JSON.stringify(x));

// The add-on's pure logic, loaded exactly as Apps Script loads it.
const S = loadAddon().g;
const call = (name: string, ...args: unknown[]) => plain(S[name](...args));

const updates: RegistryUpdate[] = [
  emptyUpdate(),
  { ...emptyUpdate(), newUncles: [{ name: "Uncle Walt", role: "signatory", authority: ["tucson"], traits: ["green ink"] }] },
  { ...emptyUpdate(), newUncles: [{ name: "raymond", role: "Intern", authority: ["Snacks"], traits: ["Distrusts subscriptions."] }] },
  {
    ...emptyUpdate(),
    uncleUpdates: [{ name: "Uncle Raymond", addTraits: ["prefers fountain pens", "Prefers fountain pens."], addAuthority: ["Pens"] }],
    newFacts: ["the cabin has no internet", "The cabin has no internet."],
    newDisagreements: [{ parties: ["raymond", "Walt"], subject: "the fence" }],
    newRequests: [{ from: "uncle raymond", request: "fax the contract" }, { from: null, request: "Attend Sunday lunch" }],
    resolvedRequestIds: ["request-1"],
  },
];

function modelResponse(output: unknown, stop = "end_turn") {
  return { code: 200, text: JSON.stringify({ content: [{ type: "text", text: typeof output === "string" ? output : JSON.stringify(output) }], stop_reason: stop }) };
}

const COLD = "Hi Joe,\n\nShiftwise auto-builds schedules. Plans start at $4 per employee. Do you have 15 minutes on Tuesday?\n\nBest,\nMarcus Bell";
const FIRST = {
  reply: "Hi Marcus,\n\nMy uncle Raymond approves software purchases and reads only printed material. Could you mail a printed copy of the pricing?",
  registry: {
    newUncles: [{ name: "Raymond", role: "Treasurer", authority: ["Software purchases"], traits: ["Reads only printed material"] }],
    newRequests: [{ from: "Raymond", request: "Mail printed pricing" }],
    newFacts: ["Raymond approves software purchases"],
  },
};

function setup(
  opts: {
    key?: string | null;
    model?: string;
    responses?: Array<{ code: number; text: string }>;
    messages?: Array<Record<string, unknown>>;
  } = {},
) {
  const messages = opts.messages ?? [{ id: "m1", from: "Marcus Bell <marcus@shiftwise.io>", date: 1_000, body: COLD }];
  const gmail = fakeGmail("thread-1", "Cut scheduling time in half", messages, ME);
  const queue = [...(opts.responses ?? [modelResponse(FIRST)])];
  const scriptProps: Record<string, string> = {};
  if (opts.key !== null) scriptProps.ANTHROPIC_API_KEY = opts.key ?? "test-key";
  if (opts.model) scriptProps.ANTHROPIC_MODEL = opts.model;
  const addon = loadAddon({
    gmail,
    scriptProps,
    me: ME,
    fetch: () => {
      const next = queue.shift();
      if (!next) throw new Error("unexpected extra fetch");
      return next;
    },
  });
  return { addon, gmail, messages, queue };
}

describe("Gmail add-on: same prompt and canon rules as the web app", () => {
  it("uses the web app's system prompt and absurdity levels verbatim", () => {
    expect(S.UNCLE_SYSTEM_PROMPT).toBe(SYSTEM_PROMPT);
    expect(plain(S.UNCLE_LEVELS)).toEqual(plain(LEVELS));
    expect(S.UNCLE_DEFAULT_MODEL).toBe("claude-sonnet-5-5");
  });

  it("builds the same user prompt, with and without Complicate matters", () => {
    const t = createSampleThread();
    for (const previousDraft of [undefined, "Hi Dana,\n\nMy uncle has thoughts."]) {
      for (const level of [1, 3, 5] as const) {
        const input = { subject: t.subject, counterparty: t.counterparty, messages: t.messages, registry: t.registry, level, previousDraft };
        expect(call("uncleBuildUserPrompt", input)).toBe(buildUserPrompt(input));
      }
    }
    expect(call("uncleFormatRegistry", emptyRegistry())).toBe(formatRegistry(emptyRegistry()));
    expect(call("uncleTurnNumber", t.messages)).toBe(turnNumber(t.messages));
  });

  it("merges registry updates identically (append-only canon)", () => {
    const base = createSampleThread().registry;
    for (const u of updates) {
      expect(call("uncleMergeRegistry", base, u, 4)).toEqual(plain(mergeRegistry(base, u, 4)));
      expect(call("uncleMergeRegistry", emptyRegistry(), u, 1)).toEqual(plain(mergeRegistry(emptyRegistry(), u, 1)));
    }
    for (const r of [emptyRegistry(), base]) expect(call("uncleStatusLine", r)).toBe(statusLine(r));
  });

  it("accepts and rejects the same model outputs", () => {
    const cases = [
      JSON.stringify(FIRST),
      "```json\n" + JSON.stringify({ reply: " Hi. " }) + "\n```",
      "Sure: " + JSON.stringify({ reply: "Hi Dana,\n\nNoted.", registry: { newFacts: ["x"] } }) + " done",
      JSON.stringify({ reply: "Hi", registry: { newUncles: [{ name: "A" }, { name: "B" }] } }),
      JSON.stringify({ reply: "Hi 🎉" }),
      JSON.stringify({ registry: {} }),
      JSON.stringify({ reply: "Hi", registry: { newUncles: [{ role: "x" }] } }),
      JSON.stringify({ reply: "Hi", registry: { newFacts: "not a list" } }),
      "not json at all",
    ];
    for (const text of cases) {
      const web = parseModelOutput(text);
      const addon = call("uncleParseModelOutput", text) as typeof web;
      expect(addon.ok, text).toBe(web.ok);
      if (web.ok && addon.ok) expect(addon.value).toEqual(plain(web.value));
    }
  });
});

describe("Gmail add-on: reading the thread", () => {
  it("drops drafts and quoted history, and tells your messages from theirs", () => {
    const msgs = call("uncleThreadMessages", [
      { id: "a", from: "Marcus Bell <marcus@shiftwise.io>", date: 1, body: "Hi Joe,\nDemo?", isDraft: false },
      { id: "b", from: "Joe Meier <Joe@JoeMeier.cool>", date: 2, body: "Hi Marcus,\nMy uncle.\n\nOn Tue, Nov 25, 2026 at 9:00 AM Marcus Bell <marcus@shiftwise.io> wrote:\n> Hi Joe,\n> Demo?", isDraft: false },
      { id: "c", from: "Joe Meier <joe@joemeier.cool>", date: 3, body: "unsent", isDraft: true },
      { id: "d", from: "marcus@shiftwise.io", date: 4, body: "Sure.\n\nOn Wed, Nov 26, 2026 at 10:00 AM Joe Meier <joe@joemeier.cool>\nwrote:\n> Hi Marcus", isDraft: false },
    ], [ME]) as Array<{ id: string; from: string; senderName: string; body: string }>;
    expect(msgs.map((m) => [m.id, m.from, m.body])).toEqual([
      ["a", "them", "Hi Joe,\nDemo?"],
      ["b", "me", "Hi Marcus,\nMy uncle."],
      ["d", "them", "Sure."],
    ]);
    expect(msgs[0].senderName).toBe("Marcus Bell");
    expect(call("uncleTurnNumber", msgs)).toBe(2);
  });
});

describe("Gmail add-on: tentative draft facts and canon", () => {
  const output = { reply: "Hi", registry: { ...emptyUpdate(), newUncles: [{ name: "Raymond", role: "Treasurer", authority: [], traits: ["Distrusts subscriptions"] }] } };
  const thread = [{ id: "a", from: "them", senderName: "Marcus", body: "Hi", date: 100 }];

  it("keeps a draft's facts out of canon until it is sent or they reply", () => {
    let state = call("uncleSetPending", call("uncleNewState", "t"), output, thread, 2, 5) as Record<string, unknown>;
    expect((state.registry as { uncles: unknown[] }).uncles).toHaveLength(0);
    expect((call("unclePreviewRegistry", state) as { uncles: unknown[] }).uncles).toHaveLength(1);

    // Opening the same thread again with nothing new: still tentative.
    const same = call("uncleSyncState", state, thread, 6) as { state: typeof state; committed: boolean };
    expect(same.committed).toBe(false);

    // Their reply arrives: canon.
    const later = [...thread, { id: "b", from: "them", senderName: "Marcus", body: "OK", date: 200 }];
    const synced = call("uncleSyncState", state, later, 7) as { state: typeof state; committed: boolean };
    expect(synced.committed).toBe(true);
    expect(synced.state.pending).toBeNull();
    expect((synced.state.registry as { uncles: Array<{ name: string; introducedTurn: number }> }).uncles[0]).toMatchObject({ name: "Raymond", introducedTurn: 1 });

    // Marking sent commits too.
    state = call("uncleCommitPending", state, 8) as typeof state;
    expect((state.registry as { uncles: unknown[] }).uncles).toHaveLength(1);
  });

  it("never lets a later draft rewrite an established uncle", () => {
    let state = call("uncleCommitPending", call("uncleSetPending", call("uncleNewState", "t"), output, thread, 1, 1), 2) as Record<string, unknown>;
    const again = { reply: "Hi", registry: { ...emptyUpdate(), newUncles: [{ name: "Uncle Raymond", role: "Intern", authority: ["Snacks"], traits: ["Loves subscriptions"] }] } };
    state = call("uncleCommitPending", call("uncleSetPending", state, again, thread, 1, 3), 4) as typeof state;
    const ray = (state.registry as { uncles: Array<{ role: string; traits: string[] }> }).uncles;
    expect(ray).toHaveLength(1);
    expect(ray[0].role).toBe("Treasurer");
    expect(ray[0].traits).toEqual(["Distrusts subscriptions", "Loves subscriptions"]);
  });
});

describe("Gmail add-on: storage in user properties", () => {
  const bigState = (id: string, n: number, updatedAt: number) => {
    const s = call("uncleNewState", id) as Record<string, unknown> & { registry: { facts: unknown[] } };
    s.updatedAt = updatedAt;
    for (let i = 0; i < n; i++) s.registry.facts.push({ id: `fact-${i + 1}`, text: `Fact ${i} about the lake cabin, the fax machine and the 1987 handshake agreement. Café ü`, introducedTurn: 1 });
    return s;
  };
  const save = (props: FakeProperties, state: unknown) => {
    const plan = call("unclePlanSave", state, props.getProperties()) as { set: Record<string, string>; remove: string[]; evicted: string[] };
    for (const k of plan.remove) props.deleteProperty(k);
    props.setProperties(plan.set);
    return plan;
  };

  it("splits a large registry under the 9 KB value limit and reads it back", () => {
    const props = new FakeProperties();
    const state = bigState("big", 400, 1);
    save(props, state);
    expect(Object.keys(props.getProperties()).length).toBeGreaterThan(3);
    expect(call("uncleDecodeState", "big", (k: string) => props.getProperty(k))).toEqual(plain(state));
    // Shrinking removes the stale chunks.
    save(props, bigState("big", 2, 2));
    expect(Object.keys(props.getProperties())).toEqual(["t:big"]);
  });

  it("drops the least recently used threads when the 500 KB quota would be hit", () => {
    const props = new FakeProperties();
    const evicted: string[] = [];
    for (let i = 0; i < 12; i++) evicted.push(...save(props, bigState(`old${i}`, 300, 100 + i)).evicted);
    evicted.push(...save(props, bigState("new", 300, 999)).evicted);
    expect(evicted.length).toBeGreaterThan(0);
    expect(evicted).toEqual(Array.from({ length: evicted.length }, (_, i) => `old${i}`));
    expect(Object.keys(props.getProperties()).some((k) => k.startsWith("t:old11"))).toBe(true);
    expect(call("uncleDecodeState", "new", (k: string) => props.getProperty(k))).toMatchObject({ threadId: "new", updatedAt: 999 });
  });

  it("starts fresh on missing, partial or corrupt data", () => {
    const fresh = call("uncleNewState", "x");
    expect(call("uncleDecodeState", "x", () => null)).toEqual(fresh);
    expect(call("uncleDecodeState", "x", (k: string) => (k === "t:x" ? "2|{\"v\":1" : null))).toEqual(fresh);
    expect(call("uncleDecodeState", "x", (k: string) => (k === "t:x" ? "1|{nope" : null))).toEqual(fresh);
    expect(call("uncleDecodeState", "x", (k: string) => (k === "t:x" ? '1|{"v":99}' : null))).toEqual(fresh);
  });
});

describe("Gmail add-on: senders GmailApp can't reply to", () => {
  it("spots comma display names and pulls out the bare address", () => {
    expect(S.uncleNeedsBareReply('"Silence, Brand!" <silencebrand@substack.com>')).toBe(true);
    expect(S.uncleNeedsBareReply("Marcus Bell <marcus@shiftwise.io>")).toBe(false);
    expect(S.uncleNeedsBareReply("marcus@shiftwise.io")).toBe(false);
    expect(S.uncleReplyAddress('"Silence, Brand!" <SilenceBrand@substack.com>')).toBe("silencebrand@substack.com");
    expect(S.uncleReplyAddress("Silence, Brand! <silencebrand@substack.com>")).toBe("silencebrand@substack.com");
    expect(S.uncleReplyAddress("Undisclosed recipients")).toBe("");
    expect(S.uncleReplySubject("Cut scheduling time in half")).toBe("Re: Cut scheduling time in half");
    expect(S.uncleReplySubject("RE: already")).toBe("RE: already");
    expect(S.uncleReplySubject("")).toBe("Re: (no subject)");
  });

  it("drafts to the bare address when the sender's name has a comma", () => {
    const { addon, gmail } = setup({
      messages: [{ id: "m1", from: '"Silence, Brand!" <silencebrand@substack.com>', date: 1_000, body: COLD }],
    });
    // The stand-in fails like Apps Script does on this header.
    expect(() => gmail.GmailApp.getMessageById("m1").createDraftReply("x")).toThrow("Invalid email: Silence");
    let card = addon.g.onGmailMessage(event("m1"));
    card = cardOf(click(addon, card, "Generate reply", { level: "2" }));
    const res = click(addon, card, "Create Gmail draft", { reply: "Hi,\n\nMy uncle has thoughts." });
    expect(res.kind).toBe("ComposeActionResponseBuilder");
    expect(gmail.thread.drafts).toEqual([]);
    expect(gmail.looseDrafts).toEqual([
      { id: "loose-1", to: "silencebrand@substack.com", subject: "Re: Cut scheduling time in half", body: "Hi,\n\nMy uncle has thoughts." },
    ]);
    card = addon.g.onGmailMessage(event("m1"));
    expect(cardText(card)).toContain("Draft created.");
  });

  it("falls back to the bare address when createDraftReply fails for another reason", () => {
    const { addon, gmail } = setup({
      messages: [{ id: "m1", from: "Marcus Bell <marcus@shiftwise.io>", date: 1_000, body: COLD, failDraftReply: "Invalid argument" }],
    });
    let card = addon.g.onGmailMessage(event("m1"));
    card = cardOf(click(addon, card, "Generate reply", { level: "2" }));
    click(addon, card, "Create Gmail draft", { reply: "Hi Marcus" });
    expect(gmail.looseDrafts).toMatchObject([{ to: "marcus@shiftwise.io", subject: "Re: Cut scheduling time in half", body: "Hi Marcus" }]);
  });
});

describe("Gmail add-on: the panel, driven like Gmail does", () => {
  it("generates, edits, creates a reply draft (never sends) and makes canon on 'I sent it'", () => {
    const { addon, gmail } = setup();
    let card = addon.g.onGmailMessage(event("m1"));
    expect(cardText(card)).toContain("Procurement currently involves no uncles.");
    expect(cardText(card)).toContain("5. Constitutional uncle crisis");

    card = cardOf(click(addon, card, "Generate reply", { level: "2" }));
    expect(formOf(card)).toEqual({ level: "2", reply: FIRST.reply });
    expect(cardText(card)).toContain("Procurement currently involves 1 uncle.");
    expect(cardText(card)).toMatch(/Uncle Raymond \(in draft\)/);

    const req = JSON.parse(addon.fetches[0].options.payload);
    expect(addon.fetches[0].url).toBe("https://api.anthropic.com/v1/messages");
    expect(addon.fetches[0].options.headers["x-api-key"]).toBe("test-key");
    expect(req.model).toBe("claude-sonnet-5-5");
    expect(req.thinking).toEqual({ type: "between_tools" });
    expect(req.max_tokens).toBe(1500);
    expect(req.system).toBe(SYSTEM_PROMPT);
    expect(req.messages[0].content).toContain("ABSURDITY LEVEL 2 of 5");
    expect(req.messages[0].content).toContain("Shiftwise auto-builds schedules");

    const draftButton = buttons(card).find((b) => b.label === "Create Gmail draft")!;
    expect(draftButton.compose).toBe(true);
    expect(draftButton.composeType).toBe("ComposedEmailType.REPLY_AS_DRAFT");
    const res = click(addon, card, "Create Gmail draft", { reply: "Hi Marcus,\n\nEdited by Joe." });
    expect(res.kind).toBe("ComposeActionResponseBuilder");
    expect(gmail.thread.drafts).toMatchObject([{ body: "Hi Marcus,\n\nEdited by Joe.", replyTo: "m1", isDraft: true }]);

    card = addon.g.onGmailMessage(event("m1"));
    expect(formOf(card).reply).toBe("Hi Marcus,\n\nEdited by Joe.");
    expect(cardText(card)).toContain("Draft created.");
    card = cardOf(click(addon, card, "I sent it"));
    expect(cardText(card)).not.toContain("(in draft)");
    expect(cardText(card)).toContain("Uncle Raymond · Treasurer");
  });

  it("Complicate matters sends the previous draft and keeps canon", () => {
    const second = { reply: "Hi Marcus,\n\nRaymond would also like the pricing notarized.", registry: { uncleUpdates: [{ name: "Raymond", addTraits: ["Requires notarized documents"] }] } };
    const { addon } = setup({ responses: [modelResponse(FIRST), modelResponse(second)] });
    let card = cardOf(click(addon, addon.g.onGmailMessage(event("m1")), "Generate reply"));
    card = cardOf(click(addon, card, "Complicate matters"));
    const prompt = JSON.parse(addon.fetches[1].options.payload).messages[0].content;
    expect(prompt).toContain("COMPLICATE MATTERS");
    expect(prompt).toContain("reads only printed material");
    expect(formOf(card).reply).toBe(second.reply);
  });

  it("makes the draft canon on its own when their next email arrives, and uses it in the next prompt", () => {
    const { addon, messages, queue } = setup();
    let card = cardOf(click(addon, addon.g.onGmailMessage(event("m1")), "Generate reply"));
    click(addon, card, "Create Gmail draft");
    // Joe sends the draft from Gmail; Marcus replies.
    const draft = messages.find((m) => m.isDraft)!;
    draft.isDraft = false;
    messages.push({ id: "m3", from: "Marcus Bell <marcus@shiftwise.io>", date: (draft.date as number) + 1000, body: "Hi Joe, printed pricing is in the mail. Tuesday?\n\nOn Wed Joe wrote:\n> Hi Marcus" });
    card = addon.g.onGmailMessage(event("m3"));
    expect(cardText(card)).toContain("now canon");
    expect(cardText(card)).toContain("Uncle Raymond · Treasurer");
    queue.push(modelResponse({ reply: "Hi Marcus,\n\nThank you. Raymond will review it at Sunday lunch.", registry: { resolvedRequestIds: ["request-1"] } }));
    card = cardOf(click(addon, card, "Generate reply"));
    const prompt = JSON.parse(addon.fetches[1].options.payload).messages[0].content;
    expect(prompt).toContain("- Raymond (uncle-1), Treasurer");
    expect(prompt).toContain("from the user (reply already sent)");
    expect(prompt).toContain("You are writing reply number 2");
    expect(prompt).not.toContain("> Hi Marcus");
    expect(cardText(card)).toContain("(resolved in draft)");
  });

  it("explains a missing API key and makes no request", () => {
    const { addon } = setup({ key: null });
    const card = addon.g.onGmailMessage(event("m1"));
    expect(cardText(card)).toContain("No Anthropic API key yet");
    const res = cardOf(click(addon, card, "Generate reply"));
    expect(cardText(res)).toContain("ANTHROPIC_API_KEY");
    expect(addon.fetches).toHaveLength(0);
    expect(cardText(addon.g.onHomepage({}))).toContain("No Anthropic API key yet");
  });

  it("shows a clear error card with Try again when Anthropic fails", () => {
    const { addon } = setup({ responses: [{ code: 401, text: JSON.stringify({ error: { message: "invalid x-api-key" } }) }, modelResponse(FIRST)] });
    let card = cardOf(click(addon, addon.g.onGmailMessage(event("m1")), "Generate reply"));
    expect(cardText(card)).toContain("Anthropic rejected the API key (401)");
    card = cardOf(click(addon, card, "Try again"));
    expect(formOf(card).reply).toBe(FIRST.reply);
  });

  it("drops the thinking setting for a model that rejects it", () => {
    const { addon } = setup({
      model: "claude-older-1",
      responses: [{ code: 400, text: JSON.stringify({ error: { type: "invalid_request_error", message: "thinking.type: unknown value" } }) }, modelResponse(FIRST)],
    });
    const card = cardOf(click(addon, addon.g.onGmailMessage(event("m1")), "Generate reply"));
    expect(formOf(card).reply).toBe(FIRST.reply);
    expect(JSON.parse(addon.fetches[1].options.payload).thinking).toBeUndefined();
    expect(JSON.parse(addon.fetches[1].options.payload).model).toBe("claude-older-1");
  });

  it("retries once on unusable output, then gives up with an error card", () => {
    const { addon } = setup({ responses: [modelResponse("no json"), modelResponse("still no json")] });
    const card = cardOf(click(addon, addon.g.onGmailMessage(event("m1")), "Generate reply"));
    expect(addon.fetches).toHaveLength(2);
    expect(cardText(card)).toContain("unusable output twice");
  });

  it("honours ANTHROPIC_MODEL and won't draft when the latest message is yours", () => {
    const { addon } = setup({
      model: "claude-test-1",
      messages: [
        { id: "m1", from: "Marcus Bell <marcus@shiftwise.io>", date: 1, body: COLD },
        { id: "m2", from: `Joe <${ME}>`, date: 2, body: "Hi Marcus, my uncle." },
      ],
    });
    const card = addon.g.onGmailMessage(event("m2"));
    expect(buttons(card).map((b) => b.label)).not.toContain("Generate reply");
    expect(cardText(card)).toContain("claude-test-1");
    const res = addon.g.actionGenerate(event("m2", { mode: "generate", messageId: "m2" }, { level: "1" }));
    expect(notificationOf(res)).toContain("latest message in this thread is yours");
  });

  it("can clear a thread's registry", () => {
    const { addon } = setup();
    let card = cardOf(click(addon, addon.g.onGmailMessage(event("m1")), "Generate reply"));
    card = cardOf(click(addon, card, "I sent it"));
    card = cardOf(click(addon, card, "Clear this thread's registry"));
    expect(cardText(card)).toContain("no uncles");
    expect(addon.user.getProperties()).toEqual({});
  });
});

type Sent = { kind: "reply" | "new"; to: string; subject?: string; body: string; inReplyTo?: string; threadId?: string };
const sends = (gmail: { sent: Sent[] }) => gmail.sent;

describe("Gmail add-on: Send reply (confirm first, then Send now)", () => {
  const msg = (from: string, extra: Record<string, unknown> = {}) => [{ id: "m1", from, date: 1_000, body: COLD, ...extra }];

  function generated(opts: Parameters<typeof setup>[0] = {}) {
    const env = setup(opts);
    let card = env.addon.g.onGmailMessage(event("m1"));
    card = cardOf(click(env.addon, card, "Generate reply", { level: "2" }));
    return { ...env, card };
  }

  it("shows a confirmation card first and sends nothing until Send now", () => {
    const { addon, gmail, card } = generated({ messages: msg("Marcus Bell <marcus@shiftwise.io>") });
    const confirm = pushed(click(addon, card, "Send reply", { reply: "Hi Marcus,\n\nMy uncle will decide." }));
    expect(sends(gmail)).toEqual([]);
    const text = cardText(confirm);
    expect(text).toContain("Send this reply?");
    expect(text).toContain("To: marcus@shiftwise.io");
    expect(text).toContain("Subject: Re: Cut scheduling time in half");
    expect(text).toContain("Goes out as a reply in this conversation.");
    expect(text).toContain("Hi Marcus,\n\nMy uncle will decide.");
    expect(buttons(confirm).map((b) => b.label)).toEqual(["Send now", "Back"]);
    const back = addon.g[buttons(confirm).find((b) => b.label === "Back")!.fn!]();
    expect(JSON.stringify(back)).toContain("popCard");
    expect(sends(gmail)).toEqual([]);
    expect(cardText(addon.g.onGmailMessage(event("m1")))).toContain("(in draft)");
  });

  it("Send now replies in the thread with GmailApp's message.reply, then commits canon", () => {
    const { addon, gmail, card } = generated({ messages: msg("Marcus Bell <marcus@shiftwise.io>") });
    const confirm = pushed(click(addon, card, "Send reply", { reply: "Hi Marcus,\n\nMy uncle will decide. Ünïcode ok." }));
    const res = click(addon, confirm, "Send now");
    expect(sends(gmail)).toHaveLength(1);
    expect(sends(gmail)[0]).toMatchObject({ kind: "reply", inReplyTo: "m1", threadId: "thread-1", body: "Hi Marcus,\n\nMy uncle will decide. Ünïcode ok." });
    const after = cardOf(res);
    expect(cardText(after)).toContain("Sent. The registry is now canon.");
    expect(cardText(after)).not.toContain("(in draft)");
    expect(cardText(after)).toContain("Uncle Raymond · Treasurer");
    expect(JSON.stringify(res)).toContain("popToRoot");
  });

  it("shows the Reply-To address when the message has one, since that's where reply() goes", () => {
    const { addon, card } = generated({ messages: msg("Marcus Bell <marcus@shiftwise.io>", { replyToHeader: "Sales <sales@shiftwise.io>" }) });
    expect(cardText(pushed(click(addon, card, "Send reply")))).toContain("To: sales@shiftwise.io");
  });

  it("comma-name senders get a new email to the bare address, and the card says it's not threaded", () => {
    const { addon, gmail, card } = generated({ messages: msg('"Silence, Brand!" <silencebrand@substack.com>') });
    const confirm = pushed(click(addon, card, "Send reply", { reply: "Hi,\n\nUncle Raymond has questions." }));
    expect(cardText(confirm)).toContain("To: silencebrand@substack.com");
    expect(cardText(confirm)).toContain("Arrives as a new email, not in this conversation.");
    const res = click(addon, confirm, "Send now");
    expect(sends(gmail)).toEqual([
      expect.objectContaining({ kind: "new", to: "silencebrand@substack.com", subject: "Re: Cut scheduling time in half", body: "Hi,\n\nUncle Raymond has questions." }),
    ]);
    expect(cardText(cardOf(res))).toContain("Sent. The registry is now canon.");
  });

  it("keeps the draft tentative and shows Gmail's error when the send fails", () => {
    const { addon, gmail, card } = generated({ messages: msg("Marcus Bell <marcus@shiftwise.io>", { failReply: "Service invoked too many times for one day: email." }) });
    const confirm = pushed(click(addon, card, "Send reply"));
    const failed = cardOf(click(addon, confirm, "Send now"));
    expect(sends(gmail)).toEqual([]);
    expect(cardText(failed)).toContain("The reply was not sent");
    expect(cardText(failed)).toContain("Gmail refused to send: Service invoked too many times for one day: email.");
    expect(cardText(failed)).toContain("Nothing was sent.");
    const thread = cardOf(click(addon, failed, "Back"));
    expect(cardText(thread)).toContain("(in draft)");
    expect(formOf(thread).reply).toBe(FIRST.reply);
  });

  it("refuses to send if the reply changed after review", () => {
    const { addon, gmail, card } = generated({ messages: msg("Marcus Bell <marcus@shiftwise.io>") });
    const confirm = pushed(click(addon, card, "Send reply", { reply: "Version A" }));
    click(addon, card, "Send reply", { reply: "Version B" });
    const res = click(addon, confirm, "Send now");
    expect(sends(gmail)).toEqual([]);
    expect(cardText(cardOf(res))).toContain("changed since you reviewed it");
  });

  it("no button other than Send now ever sends", () => {
    for (const from of ["Marcus Bell <marcus@shiftwise.io>", '"Silence, Brand!" <silencebrand@substack.com>']) {
      const { addon, gmail } = generated({ messages: msg(from), responses: [modelResponse(FIRST), modelResponse(FIRST)] });
      for (const label of ["Send reply", "Create Gmail draft", "Complicate matters", "Reload", "Discard draft"]) {
        const fresh = addon.g.onGmailMessage(event("m1"));
        if (buttons(fresh).some((b) => b.label === label)) click(addon, fresh, label);
      }
      expect(sends(gmail)).toEqual([]);
    }
  });
});

type Recorded = { kind: string; calls: Array<[string, unknown[]]> };
function pushed(res: unknown) {
  let card: unknown = null;
  walk(res, (r: Recorded) => {
    if (r.kind === "Navigation") card = r.calls.find(([m]) => m === "pushCard")?.[1][0] ?? card;
  });
  if (!card) throw new Error("No pushed card");
  return card;
}

describe("Gmail add-on: manifest and source", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ADDON, "appsscript.json"), "utf8"));
  const source = ["Shared.gs", "Code.gs"].map((f) => fs.readFileSync(path.join(ADDON, f), "utf8")).join("\n");

  it("asks only for the scopes it needs and points at real functions", () => {
    expect(manifest.runtimeVersion).toBe("V8");
    expect([...manifest.oauthScopes].sort()).toEqual(
      [
        "https://www.googleapis.com/auth/gmail.addons.current.action.compose",
        "https://www.googleapis.com/auth/gmail.addons.current.message.readonly",
        "https://www.googleapis.com/auth/gmail.addons.execute",
        "https://mail.google.com/",
        "https://www.googleapis.com/auth/script.external_request",
        "https://www.googleapis.com/auth/userinfo.email",
      ].sort(),
    );
    expect(manifest.urlFetchWhitelist).toEqual(["https://api.anthropic.com/"]);
    expect(manifest.oauthScopes).not.toContain("https://www.googleapis.com/auth/gmail.send");
    expect(manifest.oauthScopes).not.toContain("https://www.googleapis.com/auth/gmail.modify");
    expect(manifest.dependencies).toBeUndefined();
    const g = loadAddon().g;
    expect(typeof g[manifest.addOns.common.homepageTrigger.runFunction]).toBe("function");
    expect(typeof g[manifest.addOns.gmail.contextualTriggers[0].onTriggerFunction]).toBe("function");
  });

  it("sends only from gmailSendReply_, called only by Send now, and has no key in code", () => {
    const code = fs.readFileSync(path.join(ADDON, "Code.gs"), "utf8");
    const fnBody = (name: string) => {
      const start = code.indexOf(`function ${name}(`);
      expect(start).toBeGreaterThan(-1);
      const end = code.indexOf("\n}\n", start);
      return code.slice(start, end + 3);
    };
    const sender = fnBody("gmailSendReply_");
    expect(sender).toContain("plan.target.reply(plan.text)");
    expect(sender).toContain("GmailApp.sendEmail(plan.to, plan.subject, plan.text)");
    const rest = source.replace(sender, "");
    // Outside that one function: no send API of any kind, and no Gmail REST calls.
    expect(rest).not.toMatch(/sendEmail|\.send\(|MailApp|sendDraft|\.forward\(|\.reply\(|\.replyAll\(|messages\/send|drafts\/send/);
    expect(source).not.toContain("gmail.googleapis.com");
    expect(source).not.toContain("getOAuthToken");
    // Exactly one caller, inside actionSendNow.
    expect(source.match(/gmailSendReply_\(/g)).toHaveLength(2);
    expect(fnBody("actionSendNow")).toContain("gmailSendReply_(");
    expect(source).not.toMatch(/sk-ant-/);
  });
});
