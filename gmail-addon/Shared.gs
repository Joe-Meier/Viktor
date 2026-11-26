/**
 * Per My Last Uncle, Gmail add-on: shared logic.
 *
 * Pure functions only (no Gmail, CardService or network calls), so this exact file also
 * runs under Node for the repo's tests. It mirrors the web app's lib/prompt.ts,
 * lib/escalation.ts, lib/registry.ts and lib/generate.ts; tests/gmail-addon-parity.test.ts
 * fails if the prompt, levels or registry merge drift apart.
 *
 * Every top-level name starts with UNCLE_ or uncle so it cannot collide with Code.gs in
 * Apps Script's shared global scope.
 */

var UNCLE_DEFAULT_MODEL = "claude-sonnet-5-5";
var UNCLE_STORE_VERSION = 1;

var UNCLE_LEVELS = [
  {
    id: 1,
    label: "Minor family involvement",
    guidance:
      "One uncle is quietly involved in the decision. Keep the complication small and believable: a preference, a habit, a process that is slightly old-fashioned. The reply could plausibly be real.",
  },
  {
    id: 2,
    label: "Informal family oversight",
    guidance:
      "The family's involvement now shapes the buying process. Ask for something specific and mildly unusual that follows from an uncle's established habits or preferences.",
  },
  {
    id: 3,
    label: "Overlapping jurisdictions",
    guidance:
      "Authority over the purchase is unclear. Requirements may conflict, an uncle may assert a say over part of the decision, and the salesperson is asked to accommodate more than one position at once.",
  },
  {
    id: 4,
    label: "Formal family proceedings",
    guidance:
      "The family runs procurement like a governing body: motions, minutes, recusals, notice periods, information kept between specific uncles. Impose a concrete procedural requirement on the vendor.",
  },
  {
    id: 5,
    label: "Constitutional uncle crisis",
    guidance:
      "The family's governing structure itself is in dispute: competing claims of authority, founding documents, emergency sessions, contested succession. Stay calm and businesslike; the crisis is treated as a routine scheduling matter.",
  },
];

var UNCLE_SYSTEM_PROMPT = `You draft email replies for a professional who answers unsolicited sales emails. In these replies, the professional's company is a family business, and purchasing decisions involve the professional's uncles. Over a thread, the family situation becomes steadily more complicated. The professional never acknowledges that anything about it is unusual.

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

function uncleGetLevel(id) {
  var n = Number(id);
  for (var i = 0; i < UNCLE_LEVELS.length; i++) if (UNCLE_LEVELS[i].id === n) return UNCLE_LEVELS[i];
  return UNCLE_LEVELS[0];
}

function uncleEmptyRegistry() {
  return { uncles: [], disagreements: [], requests: [], facts: [] };
}

function uncleEmptyUpdate() {
  return { newUncles: [], uncleUpdates: [], newFacts: [], newDisagreements: [], newRequests: [], resolvedRequestIds: [] };
}

/* ---------- Registry (same rules as lib/registry.ts) ---------- */

function uncleCleanName(name) {
  return String(name || "").trim().replace(/^uncle\s+/i, "").trim();
}

function uncleSentenceCase(s) {
  var t = String(s || "").trim();
  return t ? t[0].toUpperCase() + t.slice(1) : t;
}

function uncleNameKey_(s) {
  return uncleCleanName(s).toLowerCase().replace(/\s+/g, " ");
}

function uncleTextKey_(s) {
  return String(s || "").trim().toLowerCase().replace(/[.\s]+$/g, "").replace(/\s+/g, " ");
}

function uncleAppendUnique_(list, additions) {
  var seen = new Set(list.map(uncleTextKey_));
  var out = list.slice();
  (additions || []).forEach(function (raw) {
    var item = uncleSentenceCase(raw);
    if (!item || seen.has(uncleTextKey_(item))) return;
    seen.add(uncleTextKey_(item));
    out.push(item);
  });
  return out;
}

function uncleNextId_(prefix, ids) {
  var max = 0;
  var re = new RegExp("^" + prefix + "-(\\d+)$");
  ids.forEach(function (id) {
    var m = String(id).match(re);
    if (m) max = Math.max(max, Number(m[1]));
  });
  return prefix + "-" + (max + 1);
}

/**
 * Merge a proposed update into the registry. Canon is append-only: existing uncles keep
 * their id, name, role, traits and authority; facts, disagreements and requests are never
 * removed or rewritten. The only change allowed on existing canon is resolving an open
 * request. Returns a new registry; the input is not mutated.
 */
function uncleMergeRegistry(registry, update, turn) {
  var uncles = registry.uncles.map(function (u) {
    return Object.assign({}, u, { authority: u.authority.slice(), traits: u.traits.slice() });
  });
  var byKey = new Map(uncles.map(function (u) { return [uncleNameKey_(u.name), u]; }));
  function addToExisting(u, traits, authority) {
    u.traits = uncleAppendUnique_(u.traits, traits);
    u.authority = uncleAppendUnique_(u.authority, authority);
  }

  (update.newUncles || []).forEach(function (proposed) {
    var name = uncleCleanName(proposed.name);
    if (!name) return;
    var existing = byKey.get(uncleNameKey_(name));
    if (existing) {
      addToExisting(existing, proposed.traits, proposed.authority);
      return;
    }
    var uncle = {
      id: uncleNextId_("uncle", uncles.map(function (u) { return u.id; })),
      name: name,
      role: uncleSentenceCase(proposed.role),
      authority: uncleAppendUnique_([], proposed.authority),
      traits: uncleAppendUnique_([], proposed.traits),
      introducedTurn: turn,
    };
    uncles.push(uncle);
    byKey.set(uncleNameKey_(name), uncle);
  });

  (update.uncleUpdates || []).forEach(function (change) {
    var existing = byKey.get(uncleNameKey_(change.name));
    if (existing) addToExisting(existing, change.addTraits, change.addAuthority);
  });

  function canonicalName(n) {
    var u = byKey.get(uncleNameKey_(n));
    return u ? u.name : uncleCleanName(n);
  }

  var facts = registry.facts.slice();
  var factKeys = new Set(facts.map(function (f) { return uncleTextKey_(f.text); }));
  (update.newFacts || []).forEach(function (raw) {
    var text = uncleSentenceCase(raw);
    if (!text || factKeys.has(uncleTextKey_(text))) return;
    factKeys.add(uncleTextKey_(text));
    facts.push({ id: uncleNextId_("fact", facts.map(function (f) { return f.id; })), text: text, introducedTurn: turn });
  });

  var disagreements = registry.disagreements.slice();
  function disKey(parties, subject) {
    return parties.map(uncleNameKey_).sort().join("|") + "::" + uncleTextKey_(subject);
  }
  var disKeys = new Set(disagreements.map(function (d) { return disKey(d.parties, d.subject); }));
  (update.newDisagreements || []).forEach(function (d) {
    var subject = uncleSentenceCase(d.subject);
    var parties = (d.parties || []).map(canonicalName).filter(Boolean);
    if (!subject || disKeys.has(disKey(parties, subject))) return;
    disKeys.add(disKey(parties, subject));
    disagreements.push({
      id: uncleNextId_("dispute", disagreements.map(function (x) { return x.id; })),
      parties: parties,
      subject: subject,
      introducedTurn: turn,
    });
  });

  var resolved = new Set(update.resolvedRequestIds || []);
  var requests = registry.requests.map(function (r) {
    return resolved.has(r.id) ? Object.assign({}, r, { status: "resolved" }) : Object.assign({}, r);
  });
  var reqKeys = new Set(requests.map(function (r) { return uncleTextKey_(r.request); }));
  (update.newRequests || []).forEach(function (r) {
    var request = uncleSentenceCase(r.request);
    if (!request || reqKeys.has(uncleTextKey_(request))) return;
    reqKeys.add(uncleTextKey_(request));
    requests.push({
      id: uncleNextId_("request", requests.map(function (x) { return x.id; })),
      from: r.from ? canonicalName(r.from) : null,
      request: request,
      status: "open",
      introducedTurn: turn,
    });
  });

  return { uncles: uncles, disagreements: disagreements, requests: requests, facts: facts };
}

/** "Procurement currently involves 3 uncles." */
function uncleStatusLine(registry) {
  var n = registry.uncles.length;
  if (n === 0) return "Procurement currently involves no uncles.";
  return "Procurement currently involves " + n + " " + (n === 1 ? "uncle" : "uncles") + ".";
}

/* ---------- Prompt (same text as lib/prompt.ts) ---------- */

function uncleFormatMessages_(messages) {
  return messages
    .map(function (m, i) {
      var who = m.from === "me" ? "the user (reply already sent)" : (m.senderName || "the salesperson") + " (salesperson)";
      return "--- Message " + (i + 1) + ", from " + who + " ---\n" + String(m.body).trim();
    })
    .join("\n\n");
}

function uncleFormatRegistry(registry) {
  if (!registry.uncles.length && !registry.facts.length && !registry.disagreements.length && !registry.requests.length) {
    return "The registry is empty. No uncles have been mentioned yet.";
  }
  var lines = [];
  lines.push("Uncles:");
  if (!registry.uncles.length) lines.push("- none yet");
  registry.uncles.forEach(function (u) {
    lines.push("- " + u.name + " (" + u.id + "), " + (u.role || "role unstated"));
    if (u.authority.length) lines.push("  Authority: " + u.authority.join("; "));
    if (u.traits.length) lines.push("  Traits: " + u.traits.join("; "));
  });
  lines.push("Disagreements:");
  if (!registry.disagreements.length) lines.push("- none yet");
  registry.disagreements.forEach(function (d) {
    lines.push("- " + (d.parties.join(" vs. ") || "family") + ": " + d.subject);
  });
  lines.push("Outstanding requests:");
  var open = registry.requests.filter(function (r) { return r.status === "open"; });
  if (!open.length) lines.push("- none open");
  open.forEach(function (r) { lines.push("- [" + r.id + "] " + (r.from ? r.from + ": " : "") + r.request); });
  registry.requests
    .filter(function (r) { return r.status === "resolved"; })
    .forEach(function (r) { lines.push("- [" + r.id + ", resolved] " + r.request); });
  lines.push("Established facts:");
  if (!registry.facts.length) lines.push("- none yet");
  registry.facts.forEach(function (f) { lines.push("- " + f.text); });
  return lines.join("\n");
}

/** Number of the reply being written: 1 for the first reply in a thread. */
function uncleTurnNumber(messages) {
  return messages.filter(function (m) { return m.from === "me"; }).length + 1;
}

/** input: { subject, counterparty, messages: [{from, senderName, body}], registry, level, previousDraft? } */
function uncleBuildUserPrompt(input) {
  var level = uncleGetLevel(input.level);
  var turn = uncleTurnNumber(input.messages);
  var parts = [
    input.subject ? "Subject: " + input.subject : "",
    input.counterparty ? "Salesperson: " + input.counterparty : "",
    "THREAD (oldest first)\n" + uncleFormatMessages_(input.messages),
    "UNCLE REGISTRY (canon, do not contradict)\n" + uncleFormatRegistry(input.registry),
    "TURN\nYou are writing reply number " + turn + " from the user in this thread.",
    "ABSURDITY LEVEL " + level.id + " of 5: " + level.label + "\n" + level.guidance,
  ];
  if (input.previousDraft && String(input.previousDraft).trim()) {
    parts.push(
      'COMPLICATE MATTERS\nThe user asked for another version of this reply. The previous draft was:\n"""\n' +
        String(input.previousDraft).trim() +
        '\n"""\nWrite a different reply that complicates matters a little further than that draft did, while staying consistent with canon. Do not reuse its central idea.',
    );
  }
  parts.push("Write the reply to the salesperson's latest message now. Return only the JSON object.");
  return parts.filter(Boolean).join("\n\n");
}

/* ---------- Response parsing (same checks as lib/generate.ts + lib/schema.ts) ---------- */

var UNCLE_EMOJI = /\p{Extended_Pictographic}/u;

function uncleExtractJson(text) {
  var trimmed = String(text).trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(trimmed);
  } catch (e) {
    var start = trimmed.indexOf("{");
    var end = trimmed.lastIndexOf("}");
    if (start === -1 || end <= start) throw new Error("No JSON object in the response.");
    return JSON.parse(trimmed.slice(start, end + 1));
  }
}

function uncleCheckUpdate_(raw) {
  var errs = [];
  var isObj = function (x) { return x !== null && typeof x === "object" && !Array.isArray(x); };
  var strList = function (v, path) {
    if (v === undefined) return [];
    if (!Array.isArray(v) || v.some(function (s) { return typeof s !== "string"; })) {
      errs.push(path + ": expected an array of strings");
      return [];
    }
    return v.slice();
  };
  var list = function (v, path, each) {
    if (v === undefined) return [];
    if (!Array.isArray(v)) {
      errs.push(path + ": expected an array");
      return [];
    }
    return v.map(function (item, i) {
      if (!isObj(item)) {
        errs.push(path + "." + i + ": expected an object");
        return null;
      }
      return each(item, path + "." + i);
    }).filter(Boolean);
  };
  var reqStr = function (v, path) {
    if (typeof v !== "string" || v.length < 1) {
      errs.push(path + ": expected a non-empty string");
      return "";
    }
    return v;
  };
  if (raw === undefined) raw = {};
  if (!isObj(raw)) return { errs: ["registry: expected an object"] };
  var update = {
    newUncles: list(raw.newUncles, "registry.newUncles", function (u, p) {
      return {
        name: reqStr(u.name, p + ".name"),
        role: u.role === undefined ? "" : typeof u.role === "string" ? u.role : (errs.push(p + ".role: expected a string"), ""),
        authority: strList(u.authority, p + ".authority"),
        traits: strList(u.traits, p + ".traits"),
      };
    }),
    uncleUpdates: list(raw.uncleUpdates, "registry.uncleUpdates", function (u, p) {
      return { name: reqStr(u.name, p + ".name"), addTraits: strList(u.addTraits, p + ".addTraits"), addAuthority: strList(u.addAuthority, p + ".addAuthority") };
    }),
    newFacts: strList(raw.newFacts, "registry.newFacts"),
    newDisagreements: list(raw.newDisagreements, "registry.newDisagreements", function (d, p) {
      return { parties: strList(d.parties, p + ".parties"), subject: reqStr(d.subject, p + ".subject") };
    }),
    newRequests: list(raw.newRequests, "registry.newRequests", function (r, p) {
      var from = r.from === undefined || r.from === null ? null : typeof r.from === "string" ? r.from : (errs.push(p + ".from: expected a string or null"), null);
      return { from: from, request: reqStr(r.request, p + ".request") };
    }),
    resolvedRequestIds: strList(raw.resolvedRequestIds, "registry.resolvedRequestIds"),
  };
  return { errs: errs, update: update };
}

/** Parse and check one model response: { ok: true, value: {reply, registry} } or { ok: false, reason }. */
function uncleParseModelOutput(text) {
  var raw;
  try {
    raw = uncleExtractJson(text);
  } catch (e) {
    return { ok: false, reason: "The response was not valid JSON (" + e.message + ")." };
  }
  var errs = [];
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    errs.push(": expected an object");
  } else if (typeof raw.reply !== "string" || raw.reply.length < 1) {
    errs.push("reply: expected a non-empty string");
  }
  var checked = errs.length ? { errs: [] } : uncleCheckUpdate_(raw.registry);
  errs = errs.concat(checked.errs);
  if (errs.length) return { ok: false, reason: "The JSON did not match the required shape: " + errs.join("; ") + "." };
  var value = { reply: raw.reply, registry: checked.update };
  if (value.registry.newUncles.length > 1) {
    return { ok: false, reason: "It introduced more than one new uncle. Introduce at most one." };
  }
  if (UNCLE_EMOJI.test(value.reply)) {
    return { ok: false, reason: "The reply contained an emoji. Use plain text only." };
  }
  return { ok: true, value: { reply: value.reply.trim(), registry: value.registry } };
}

/**
 * Body for POST https://api.anthropic.com/v1/messages. Thinking is turned off
 * ("between_tools" on claude-sonnet-5-5): thinking tokens count against max_tokens and cut
 * replies off, and add-on actions must finish within about 30 seconds. Models that do not
 * know the setting get it removed by uncleWithoutThinking.
 */
function uncleRequestBody(model, messages) {
  return { model: model, max_tokens: 1500, thinking: { type: "between_tools" }, system: UNCLE_SYSTEM_PROMPT, messages: messages };
}

/** If the API rejected the thinking setting (status 400 naming it), the body to retry with; else null. */
function uncleWithoutThinking(body, status, responseText) {
  if (status !== 400 || !body.thinking || !/thinking/i.test(String(responseText))) return null;
  var copy = Object.assign({}, body);
  delete copy.thinking;
  return copy;
}

/**
 * Ask the model for a reply and a registry update, with one retry on unusable output.
 * send(body) does the HTTP call and returns the parsed API response, or throws.
 * Apps Script passes a UrlFetchApp-based send; Node tests pass a fake or a real one.
 * opts.budgetMs: skip the retry when the first attempt already took longer (add-on
 * actions are cut off at about 30 seconds).
 */
function uncleGenerate(send, model, input, opts) {
  opts = opts || {};
  var now = opts.now || function () { return Date.now(); };
  var started = now();
  var messages = [{ role: "user", content: uncleBuildUserPrompt(input) }];
  var lastReason = "";
  for (var attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0 && opts.budgetMs && now() - started > opts.budgetMs) break;
    var response;
    try {
      response = send(uncleRequestBody(model, messages));
    } catch (e) {
      var err = new Error("The model request failed: " + (e && e.message ? e.message : e));
      err.code = "upstream_error";
      throw err;
    }
    var text = (response.content || [])
      .map(function (b) { return b.type === "text" ? b.text : ""; })
      .join("")
      .trim();
    var result =
      response.stop_reason === "max_tokens"
        ? { ok: false, reason: "The response was cut off before the JSON was complete. Keep it shorter." }
        : uncleParseModelOutput(text);
    if (result.ok) return result.value;
    lastReason = result.reason;
    messages.push(
      { role: "assistant", content: text || "(empty)" },
      { role: "user", content: "That output could not be used: " + result.reason + " Return only the JSON object described in the instructions, nothing else." },
    );
  }
  var e2 = new Error("The model returned unusable output" + (attempt > 1 ? " twice" : "") + ". " + lastReason);
  e2.code = "bad_output";
  throw e2;
}

/** Turn an Anthropic error response into one plain sentence. */
function uncleApiErrorMessage(status, bodyText) {
  var detail = "";
  try {
    var j = JSON.parse(bodyText);
    detail = (j && j.error && j.error.message) || "";
  } catch (e) {
    detail = String(bodyText || "").slice(0, 200);
  }
  if (status === 401) return "Anthropic rejected the API key (401). Check ANTHROPIC_API_KEY in Project Settings > Script properties.";
  if (status === 404) return "Anthropic does not know that model (404). Check ANTHROPIC_MODEL in Script properties, or delete it to use " + UNCLE_DEFAULT_MODEL + ". " + detail;
  if (status === 429) return "Anthropic rate limit reached (429). Wait a minute and try again.";
  if (status === 529 || status >= 500) return "Anthropic is having trouble (" + status + "). Try again in a minute.";
  return "Anthropic returned an error (" + status + "). " + detail;
}

/* ---------- Reading a Gmail thread ---------- */

/** Drop the quoted history Gmail keeps under a reply ("On ... wrote:" and "> " lines). */
function uncleStripQuoted(body) {
  var lines = String(body || "").replace(/\r\n/g, "\n").split("\n");
  var out = [];
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    if (/^\s*On .+wrote:\s*$/i.test(line)) break;
    if (/^\s*On .+$/i.test(line) && i + 1 < lines.length && /^.*wrote:\s*$/i.test(lines[i + 1]) && lines[i + 1].length < 120) break;
    if (/^-{2,}\s*Original Message\s*-{2,}/i.test(line)) break;
    if (/^\s*>/.test(line)) continue;
    out.push(line);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** "Marcus Bell <marcus@shiftwise.io>" -> { name: "Marcus Bell", email: "marcus@shiftwise.io" } */
function uncleParseAddress(from) {
  var s = String(from || "").trim();
  var m = s.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1].trim(), email: m[2].trim().toLowerCase() };
  return { name: "", email: s.toLowerCase() };
}

/**
 * GmailApp's createDraftReply splits the original From header on commas, so a sender like
 * "Silence, Brand!" <x@y.com> fails with "Invalid email: Silence". Those get a new draft
 * addressed to the bare address instead.
 */
function uncleNeedsBareReply(from) {
  return uncleParseAddress(from).name.indexOf(",") !== -1;
}

/** The bare address to reply to, or "" when the header has none. */
function uncleReplyAddress(from) {
  var email = uncleParseAddress(from).email;
  return /^[^\s@<>",]+@[^\s@<>",]+$/.test(email) ? email : "";
}

/** "Cut costs" -> "Re: Cut costs"; leaves an existing "Re:" alone. */
function uncleReplySubject(subject) {
  var s = String(subject || "").trim();
  if (/^re:/i.test(s)) return s;
  return "Re: " + (s || "(no subject)");
}

/** The header GmailApp's reply() answers: Reply-To when the message has one, else From. */
function uncleReplyHeader(replyTo, from) {
  var r = String(replyTo || "").trim();
  return r && uncleReplyAddress(r) ? r : String(from || "");
}

/** A short fingerprint of what the confirmation card showed, so Send now sends exactly that. */
function uncleSendSignature(to, subject, text) {
  var str = [to, subject, text].join("\u0000");
  var h = 5381;
  for (var i = 0; i < str.length; i++) h = ((h * 33) ^ str.charCodeAt(i)) >>> 0;
  return h.toString(36) + "." + str.length;
}

var UNCLE_MAX_BODY = 20000;
var UNCLE_MAX_MESSAGES = 60;

/**
 * raw: [{ id, from (header), date (ms), body, isDraft }] oldest first.
 * myEmails: the user's addresses (lowercase). Returns the prompt's message list (drafts
 * dropped, quotes stripped, long bodies cut, at most 60 messages keeping the first).
 */
function uncleThreadMessages(raw, myEmails) {
  var mine = new Set((myEmails || []).map(function (e) { return String(e).trim().toLowerCase(); }).filter(Boolean));
  var msgs = raw
    .filter(function (m) { return !m.isDraft; })
    .map(function (m) {
      var addr = uncleParseAddress(m.from);
      var from = mine.has(addr.email) ? "me" : "them";
      var body = uncleStripQuoted(m.body) || String(m.body || "").trim();
      if (body.length > UNCLE_MAX_BODY) body = body.slice(0, UNCLE_MAX_BODY) + "\n[cut]";
      return { id: m.id, from: from, senderName: from === "me" ? "You" : addr.name || addr.email, body: body, date: m.date };
    })
    .filter(function (m) { return m.body; });
  if (msgs.length > UNCLE_MAX_MESSAGES) msgs = [msgs[0]].concat(msgs.slice(msgs.length - (UNCLE_MAX_MESSAGES - 1)));
  return msgs;
}

/* ---------- Per-thread state and canon ---------- */

function uncleNewState(threadId) {
  // updatedAt comes early so it lands in the first stored chunk (eviction reads it there).
  return { v: UNCLE_STORE_VERSION, threadId: threadId, updatedAt: 0, level: 1, registry: uncleEmptyRegistry(), pending: null };
}

/** Check a stored state; anything unreadable starts over rather than breaking the panel. */
function uncleNormalizeState(raw, threadId) {
  var fresh = uncleNewState(threadId);
  if (!raw || typeof raw !== "object" || raw.v !== UNCLE_STORE_VERSION) return fresh;
  var reg = raw.registry;
  if (!reg || !Array.isArray(reg.uncles) || !Array.isArray(reg.facts) || !Array.isArray(reg.requests) || !Array.isArray(reg.disagreements)) return fresh;
  var p = raw.pending;
  var pending = p && typeof p.text === "string" && p.update && typeof p.basedOn === "number" ? p : null;
  return { v: UNCLE_STORE_VERSION, threadId: threadId, updatedAt: Number(raw.updatedAt) || 0, level: uncleGetLevel(raw.level).id, registry: reg, pending: pending };
}

/** Registry as it will look once the pending draft is sent (what the panel shows). */
function unclePreviewRegistry(state) {
  if (!state.pending) return state.registry;
  return uncleMergeRegistry(state.registry, state.pending.update, state.pending.turn);
}

/** Make the pending draft's registry changes canon. */
function uncleCommitPending(state, now) {
  if (!state.pending) return state;
  return Object.assign({}, state, {
    registry: uncleMergeRegistry(state.registry, state.pending.update, state.pending.turn),
    pending: null,
    updatedAt: now || Date.now(),
  });
}

/**
 * A pending draft becomes canon on its own once the thread has a message newer than the
 * one it answered: the other party replied (so it was sent), or the user's own sent
 * reply is now in the thread. Returns { state, committed }.
 */
function uncleSyncState(state, messages, now) {
  if (!state.pending) return { state: state, committed: false };
  var newer = messages.some(function (m) { return m.date > state.pending.basedOn; });
  if (!newer) return { state: state, committed: false };
  return { state: uncleCommitPending(state, now), committed: true };
}

/** Store a freshly generated reply as the pending (tentative) draft. */
function uncleSetPending(state, output, messages, level, now) {
  var last = messages[messages.length - 1];
  return Object.assign({}, state, {
    level: uncleGetLevel(level).id,
    pending: {
      text: output.reply,
      update: output.registry,
      level: uncleGetLevel(level).id,
      turn: uncleTurnNumber(messages),
      basedOn: last ? last.date : 0,
      draftCreated: false,
    },
    updatedAt: now || Date.now(),
  });
}

/* ---------- Storage: user properties, chunked, oldest threads evicted ---------- */

var UNCLE_PROP_MAX = 8500; // Apps Script allows 9 KB per value
var UNCLE_STORE_BUDGET = 420000; // of the 500 KB per user, leaving headroom

function uncleStateKey(threadId) {
  return "t:" + threadId;
}

/** Split a state into property values: { "t:<id>": "<n>|<chunk0>", "t:<id>:1": "<chunk1>", ... } */
function uncleEncodeState(state) {
  // Escape non-ASCII so characters equal bytes and every chunk fits the 9 KB limit.
  var json = JSON.stringify(state).replace(/[\u007f-\uffff]/g, function (c) {
    return "\\u" + ("0000" + c.charCodeAt(0).toString(16)).slice(-4);
  });
  var key = uncleStateKey(state.threadId);
  var chunks = [];
  for (var i = 0; i < json.length || i === 0; i += UNCLE_PROP_MAX - 10) chunks.push(json.slice(i, i + UNCLE_PROP_MAX - 10));
  var out = {};
  out[key] = chunks.length + "|" + chunks[0];
  for (var c = 1; c < chunks.length; c++) out[key + ":" + c] = chunks[c];
  return out;
}

/** get(key) -> string|null. Returns the state, or a fresh one if missing or unreadable. */
function uncleDecodeState(threadId, get) {
  var key = uncleStateKey(threadId);
  var head = get(key);
  if (!head) return uncleNewState(threadId);
  var bar = head.indexOf("|");
  var n = Number(head.slice(0, bar));
  if (bar < 1 || !(n >= 1)) return uncleNewState(threadId);
  var json = head.slice(bar + 1);
  for (var c = 1; c < n; c++) {
    var part = get(key + ":" + c);
    if (part === null || part === undefined) return uncleNewState(threadId);
    json += part;
  }
  try {
    return uncleNormalizeState(JSON.parse(json), threadId);
  } catch (e) {
    return uncleNewState(threadId);
  }
}

/** Keys that belong to a thread's state, from a list of all property keys. */
function uncleKeysForThread(threadId, allKeys) {
  var key = uncleStateKey(threadId);
  return allKeys.filter(function (k) { return k === key || k.indexOf(key + ":") === 0; });
}

/**
 * Plan a save. props: every current user property {key: value}. Returns
 * { set: {...}, remove: [keys], evicted: [threadIds] }: writes for this thread, its stale
 * chunks, and the least recently updated other threads to drop if the total would pass
 * the budget.
 */
function unclePlanSave(state, props) {
  var set = uncleEncodeState(state);
  var mine = uncleKeysForThread(state.threadId, Object.keys(props));
  var remove = mine.filter(function (k) { return !(k in set); });
  var size = function (obj, skip) {
    var n = 0;
    Object.keys(obj).forEach(function (k) { if (!skip || !skip(k)) n += k.length + String(obj[k]).length; });
    return n;
  };
  var mineSet = new Set(mine);
  var total = size(props, function (k) { return mineSet.has(k); }) + size(set);
  var others = Object.keys(props)
    .filter(function (k) { return /^t:[^:]+$/.test(k) && !mineSet.has(k); })
    .map(function (k) {
      var id = k.slice(2);
      var updatedAt = 0;
      var m = String(props[k]).match(/"updatedAt":(\d+)/);
      if (m) updatedAt = Number(m[1]);
      return { id: id, updatedAt: updatedAt };
    })
    .sort(function (a, b) { return a.updatedAt - b.updatedAt; });
  var evicted = [];
  while (total > UNCLE_STORE_BUDGET && others.length) {
    var victim = others.shift();
    uncleKeysForThread(victim.id, Object.keys(props)).forEach(function (k) {
      total -= k.length + String(props[k]).length;
      remove.push(k);
    });
    evicted.push(victim.id);
  }
  return { set: set, remove: remove, evicted: evicted };
}

/* Node: expose everything for tests and the live check. Apps Script ignores this. */
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    UNCLE_DEFAULT_MODEL: UNCLE_DEFAULT_MODEL,
    UNCLE_LEVELS: UNCLE_LEVELS,
    UNCLE_SYSTEM_PROMPT: UNCLE_SYSTEM_PROMPT,
    uncleGetLevel: uncleGetLevel,
    uncleEmptyRegistry: uncleEmptyRegistry,
    uncleEmptyUpdate: uncleEmptyUpdate,
    uncleCleanName: uncleCleanName,
    uncleMergeRegistry: uncleMergeRegistry,
    uncleStatusLine: uncleStatusLine,
    uncleFormatRegistry: uncleFormatRegistry,
    uncleTurnNumber: uncleTurnNumber,
    uncleBuildUserPrompt: uncleBuildUserPrompt,
    uncleExtractJson: uncleExtractJson,
    uncleParseModelOutput: uncleParseModelOutput,
    uncleRequestBody: uncleRequestBody,
    uncleWithoutThinking: uncleWithoutThinking,
    uncleGenerate: uncleGenerate,
    uncleApiErrorMessage: uncleApiErrorMessage,
    uncleStripQuoted: uncleStripQuoted,
    uncleParseAddress: uncleParseAddress,
    uncleNeedsBareReply: uncleNeedsBareReply,
    uncleReplyAddress: uncleReplyAddress,
    uncleReplySubject: uncleReplySubject,
    uncleReplyHeader: uncleReplyHeader,
    uncleSendSignature: uncleSendSignature,
    uncleThreadMessages: uncleThreadMessages,
    uncleNewState: uncleNewState,
    uncleNormalizeState: uncleNormalizeState,
    unclePreviewRegistry: unclePreviewRegistry,
    uncleCommitPending: uncleCommitPending,
    uncleSyncState: uncleSyncState,
    uncleSetPending: uncleSetPending,
    uncleEncodeState: uncleEncodeState,
    uncleDecodeState: uncleDecodeState,
    uncleKeysForThread: uncleKeysForThread,
    unclePlanSave: unclePlanSave,
  };
}
