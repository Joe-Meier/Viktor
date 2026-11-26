// Live check: runs the add-on's real code (Shared.gs + Code.gs) against the Anthropic API,
// with Gmail stood in by a fake thread. A cold email, two follow-ups written by a second
// model call playing the salesperson, then Complicate matters. Not part of the add-on.
//
//   ANTHROPIC_API_KEY=... node gmail-addon/dev/live-check.mjs [outDir]
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { cardOf, cardText, click, event, fakeGmail, formOf, loadAddon } from "./harness.mjs";

const KEY = process.env.ANTHROPIC_API_KEY;
if (!KEY) {
  console.error("Set ANTHROPIC_API_KEY first.");
  process.exit(1);
}
const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";
const OUT = process.argv[2] || path.join(os.tmpdir(), "addon-live");
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const ME = "joe@joemeier.cool";
const headerFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "uncle-")), "h");
fs.writeFileSync(headerFile, `x-api-key: ${KEY}\nanthropic-version: 2023-06-01\ncontent-type: application/json\n`, { mode: 0o600 });

/** UrlFetchApp stand-in: a blocking HTTPS call, like Apps Script's. */
function curl(url, payload) {
  const out = execFileSync("curl", ["-sS", "-X", "POST", url, "-H", `@${headerFile}`, "--data-binary", "@-", "-w", "\n%{http_code}", "--max-time", "120"], {
    input: payload,
    maxBuffer: 10 * 1024 * 1024,
  }).toString();
  const i = out.lastIndexOf("\n");
  return { code: Number(out.slice(i + 1)), text: out.slice(0, i) };
}

const timings = [];
function fetchStub(url, options) {
  const t0 = Date.now();
  const r = curl(url, options.payload);
  timings.push(Date.now() - t0);
  fs.appendFileSync(path.join(OUT, "responses.jsonl"), JSON.stringify({ ms: Date.now() - t0, code: r.code, request: JSON.parse(options.payload).messages.length, response: r.text }) + "\n");
  return r;
}

function claude(system, user, maxTokens = 1200) {
  const r = curl("https://api.anthropic.com/v1/messages", JSON.stringify({ model: MODEL, max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] }));
  if (r.code !== 200) throw new Error(`Anthropic ${r.code}: ${r.text.slice(0, 300)}`);
  return JSON.parse(r.text).content.map((b) => b.text || "").join("").trim();
}

const COLD = `Hi Joe,

I'm reaching out because teams like yours usually lose 6-8 hours a week building shift schedules in spreadsheets. Shiftwise auto-builds schedules from staff availability, flags overtime before it happens, and lets people swap shifts from their phones.

We just helped Harbor & Pine Bakeries cut scheduling time by 54% across 12 locations. Plans start at $4 per employee per month, billed annually.

Do you have 15 minutes on Tuesday or Wednesday for a quick demo?

Best,
Marcus Bell
Account Executive, Shiftwise`;

const MARCUS = "Marcus Bell <marcus@shiftwise.io>";
const messages = [{ id: "m1", from: MARCUS, date: Date.parse("2026-11-24T09:00:00Z"), body: COLD }];
const gmail = fakeGmail("thread-live", "Cut scheduling time in half at your locations", messages, ME);
const addon = loadAddon({ gmail, scriptProps: { ANTHROPIC_API_KEY: KEY, ANTHROPIC_MODEL: MODEL }, me: ME, fetch: fetchStub });

const stateNow = () => addon.g.uncleDecodeState("thread-live", (k) => addon.user.getProperty(k));
const threadText = () =>
  messages
    .filter((m) => !m.isDraft)
    .map((m) => `--- ${m.from === MARCUS ? "Marcus (you)" : "Joe (prospect)"} ---\n${m.body.split(/\n\s*On .*wrote:/)[0]}`)
    .join("\n\n");

/** Gmail adds the quoted history under a sent reply; mimic it so the add-on has to strip it. */
const quoted = (body, prev) => `${body}\n\nOn Tue, Nov 25, 2026 at 9:14 AM ${prev.from} wrote:\n${prev.body.split("\n").map((l) => `> ${l}`).join("\n")}`;

const log = { model: MODEL, turns: [], checks: [] };
let lastMsgId = "m1";
const plan = [
  { level: "1", sentVia: "I sent it" },
  { level: "3", sentVia: "their reply" },
  { level: "5", sentVia: null },
];

for (let i = 0; i < plan.length; i++) {
  const step = plan[i];
  const canonBefore = stateNow().registry;
  let card = addon.g.onGmailMessage(event(lastMsgId));
  const panelOnOpen = cardText(card).split("\n")[0];
  card = cardOf(click(addon, card, "Generate reply", { level: step.level }));
  const reply = formOf(card).reply;
  if (!reply) throw new Error(`No reply on turn ${i + 1}:\n${cardText(card)}`);
  const st = stateNow();
  log.turns.push({ turn: i + 1, level: Number(step.level), panelOnOpen, reply, tentative: st.pending.update, ms: timings[timings.length - 1] });
  fs.writeFileSync(path.join(OUT, `card-turn${i + 1}.txt`), cardText(card));

  // Canon from earlier turns is still there, unchanged.
  for (const u of canonBefore.uncles) {
    const now = st.registry.uncles.find((x) => x.id === u.id);
    log.checks.push({ turn: i + 1, check: `uncle ${u.name} kept`, ok: !!now && now.role === u.role && u.traits.every((t) => now.traits.includes(t)) });
  }
  // The draft's own facts are tentative until sent.
  log.checks.push({ turn: i + 1, check: "draft facts tentative", ok: JSON.stringify(st.registry) === JSON.stringify(canonBefore) });

  if (i === plan.length - 1) {
    const before = reply;
    card = cardOf(click(addon, card, "Complicate matters"));
    log.complicated = { before, after: formOf(card).reply || `(error) ${cardText(card)}`, ms: timings[timings.length - 1] };
    fs.writeFileSync(path.join(OUT, "card-complicated.txt"), cardText(card));
    break;
  }

  // Joe creates the Gmail draft, then sends it from Gmail.
  click(addon, card, "Create Gmail draft");
  const draft = messages.find((m) => m.isDraft);
  if (step.sentVia === "I sent it") {
    // Draft still unsent in Gmail: reopening keeps it tentative; "I sent it" makes it canon.
    card = addon.g.onGmailMessage(event(lastMsgId));
    log.checks.push({ turn: i + 1, check: "still tentative while the Gmail draft is unsent", ok: stateNow().pending !== null });
    click(addon, card, "I sent it");
    log.checks.push({ turn: i + 1, check: "canon after I sent it", ok: stateNow().pending === null });
  }
  const prev = messages.find((m) => m.id === lastMsgId);
  draft.isDraft = false;
  draft.id = `sent-${i + 1}`;
  draft.body = quoted(draft.body, prev);
  draft.date = prev.date + 3600_000;

  const followup = claude(
    "You are Marcus Bell, an upbeat but professional SDR at Shiftwise (shift scheduling software). Write your next follow-up email in this thread: accommodate the prospect's latest request as best you can, answer any question concretely, and push toward a demo or pilot. 3-5 sentences plus a greeting and sign-off 'Marcus'. Output only the email body.",
    threadText(),
  );
  const id = `m${i + 2}`;
  messages.push({ id, from: MARCUS, date: draft.date + 3600_000, body: quoted(followup, draft) });
  log.turns[log.turns.length - 1].theirFollowup = followup;
  lastMsgId = id;
  // Their reply arrives: whatever was pending is canon now.
  addon.g.onGmailMessage(event(id));
  log.checks.push({ turn: i + 1, check: "canon after their reply", ok: stateNow().pending === null });
}

// Tone: 2-4 sentences after the greeting, no exclamation marks, emoji or wink words.
const BANNED = /\b(funny|absurd|ridiculous|joke|bizarre|unusual|quirky)\b/i;
log.checks.push({ turn: "complicated", check: "Complicate matters produced a new reply", ok: !log.complicated.after.startsWith("(error)") && log.complicated.after !== log.complicated.before });
for (const t of [...log.turns, { turn: "complicated", reply: log.complicated.after }]) {
  const body = t.reply.replace(/^[^\n]*,\s*\n/, "").trim();
  const sentences = body.split(/(?<=[.?])\s+/).filter((s) => s.trim()).length;
  const words = body.split(/\s+/).length;
  t.sentences = sentences;
  t.words = words;
  log.checks.push({ turn: t.turn, check: `2-4 sentences (${sentences}, ${words} words)`, ok: sentences >= 2 && sentences <= 4 });
  log.checks.push({ turn: t.turn, check: "no ! / emoji / wink words", ok: !/!/.test(body) && !/\p{Extended_Pictographic}/u.test(body) && !BANNED.test(body) });
}

// A second model reads the final registry and every reply and looks for contradictions.
const finalState = stateNow();
log.finalRegistry = finalState.registry;
log.pendingAtEnd = finalState.pending;
const judge = claude(
  'You check a fictional email thread for continuity. Given the canon registry and the replies in order, list any place where a later reply contradicts an earlier reply or the registry (an uncle with a different name, role or trait; a fact reversed). New developments, new disagreements and escalation are expected and are not contradictions. Also rate the tone of each reply: "dry" if it is sincere, understated business prose with no jokes or winks, else "not dry". Return only JSON: {"contradictions": ["..."], "tone": ["dry"|"not dry", ...]}',
  `REGISTRY\n${JSON.stringify(finalState.registry, null, 1)}\n\nREPLIES\n${[...log.turns.map((t) => t.reply), log.complicated.after].map((r, i) => `#${i + 1}\n${r}`).join("\n\n")}`,
  800,
);
try {
  log.judge = addon.g.uncleExtractJson(judge);
} catch {
  log.judge = { raw: judge };
}
// The judge is a second opinion, reported but not a hard gate.
log.checks.push({ turn: "all", advisory: true, check: "judge: no contradictions", ok: Array.isArray(log.judge.contradictions) && log.judge.contradictions.length === 0 });
log.checks.push({ turn: "all", advisory: true, check: "judge: every reply dry", ok: Array.isArray(log.judge.tone) && log.judge.tone.every((x) => x === "dry") });
log.timingsMs = timings;
log.gmailDrafts = gmail.thread.drafts.map((d) => ({ replyTo: d.replyTo }));

fs.writeFileSync(path.join(OUT, "live.json"), JSON.stringify(log, null, 2));
for (const t of log.turns) {
  console.log(`\n=== Turn ${t.turn} (level ${t.level}, ${t.ms} ms) | panel: ${t.panelOnOpen}\n${t.reply}`);
  if (t.theirFollowup) console.log(`--- Marcus replies ---\n${t.theirFollowup}`);
}
console.log(`\n=== Complicate matters (${log.complicated.ms} ms)\n${log.complicated.after}`);
console.log("\n=== Final registry\n" + addon.g.uncleFormatRegistry(finalState.registry));
console.log("\n=== Checks");
for (const c of log.checks) console.log(`${c.ok ? "PASS" : c.advisory ? "NOTE" : "FAIL"}  [${c.turn}] ${c.check}`);
console.log("judge:", JSON.stringify(log.judge));
console.log("timings ms:", timings.join(", "));
fs.rmSync(path.dirname(headerFile), { recursive: true, force: true });
if (log.checks.some((c) => !c.ok && !c.advisory)) process.exitCode = 2;
