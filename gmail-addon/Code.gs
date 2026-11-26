/**
 * Per My Last Uncle, Gmail add-on: cards, Gmail, storage and the Anthropic call.
 * The prompt, parsing, registry and canon rules live in Shared.gs.
 *
 * Nothing here sends email. "Create Gmail draft" opens a reply draft for you to review and
 * send yourself.
 */

var UNCLE_LOGO = "https://www.gstatic.com/images/icons/material/system/2x/elderly_black_48dp.png";
var UNCLE_API_URL = "https://api.anthropic.com/v1/messages";
var UNCLE_TIME_BUDGET_MS = 12000; // skip the retry after this; add-on actions stop at ~30 s

/* ---------- Triggers ---------- */

/** Homepage: shown when no email is open. */
function onHomepage(e) {
  var config = readConfig_();
  var card = CardService.newCardBuilder().setHeader(header_("Per My Last Uncle", "Uncle Registry for sales email"));
  var intro = CardService.newCardSection()
    .addWidget(text_("Open a sales email. This panel then shows that thread's Uncle Registry and drafts a sincere reply involving your uncles."))
    .addWidget(text_("Replies go into Gmail as drafts. Nothing is ever sent for you."));
  card.addSection(intro);
  card.addSection(setupSection_(config));
  return card.build();
}

/** Contextual trigger: an email is open. */
function onGmailMessage(e) {
  try {
    var ctx = openContext_(e);
    var state = loadSynced_(ctx);
    return threadCard_(ctx, state.state, state.notice);
  } catch (err) {
    return errorCard_("Could not read this email", errMessage_(err), false);
  }
}

/* ---------- Actions ---------- */

/** "Generate reply" and "Complicate matters". Parameter mode: "generate" | "complicate". */
function actionGenerate(e) {
  var ctx;
  try {
    ctx = openContext_(e);
  } catch (err) {
    return updateCard_(errorCard_("Could not read this email", errMessage_(err), false));
  }
  var config = readConfig_();
  if (!config.apiKey) return updateCard_(missingKeyCard_());

  var loaded = loadSynced_(ctx);
  var state = loaded.state;
  var msgs = ctx.messages;
  if (!msgs.length || msgs[msgs.length - 1].from !== "them") {
    return notify_("The latest message in this thread is yours. Wait for their reply, then generate.");
  }
  var level = Number(formValue_(e, "level")) || state.level;
  var complicate = param_(e, "mode") === "complicate";
  var previousDraft = complicate ? formValue_(e, "reply") || (state.pending && state.pending.text) || "" : "";

  var output;
  try {
    output = uncleGenerate(anthropicSend_(config.apiKey), config.model, {
      subject: ctx.subject,
      counterparty: ctx.counterparty,
      messages: msgs,
      registry: state.registry,
      level: level,
      previousDraft: previousDraft || undefined,
    }, { budgetMs: UNCLE_TIME_BUDGET_MS });
  } catch (err) {
    return updateCard_(errorCard_("The reply could not be generated", errMessage_(err), true, param_(e, "mode") || "generate", ctx.messageId));
  }
  state = uncleSetPending(state, output, msgs, level, Date.now());
  var saved = saveState_(state);
  return updateCard_(threadCard_(ctx, state, saveNotice_(saved)));
}

/**
 * "Create Gmail draft": a compose action. Returns a reply draft in this thread for the
 * user to review and send. It never sends.
 */
function actionCreateDraft(e) {
  var ctx = openContext_(e);
  var loaded = loadSynced_(ctx);
  var state = loaded.state;
  var text = String(formValue_(e, "reply") || (state.pending && state.pending.text) || "").trim();
  if (!text) throw new Error("Generate or write a reply first.");
  var target = ctx.replyTarget || ctx.message;
  var draft;
  try {
    draft = target.createDraftReply(text);
  } catch (err) {
    if (target === ctx.message) throw err;
    draft = ctx.message.createDraftReply(text);
  }
  if (state.pending) {
    state = Object.assign({}, state, {
      pending: Object.assign({}, state.pending, { text: text, draftCreated: true }),
      updatedAt: Date.now(),
    });
    saveState_(state);
  }
  return CardService.newComposeActionResponseBuilder().setGmailDraft(draft).build();
}

/** "I sent it": the draft's registry changes become canon. */
function actionMarkSent(e) {
  var ctx = openContext_(e);
  var state = loadSynced_(ctx).state;
  if (!state.pending) return updateCard_(threadCard_(ctx, state, "Nothing pending; the registry is up to date."));
  state = uncleCommitPending(state, Date.now());
  var saved = saveState_(state);
  return updateCard_(threadCard_(ctx, state, saveNotice_(saved) || "Recorded as sent. The registry is now canon."));
}

/** Drop the pending draft (its tentative registry changes go with it). */
function actionDiscard(e) {
  var ctx = openContext_(e);
  var state = loadSynced_(ctx).state;
  state = Object.assign({}, state, { pending: null, updatedAt: Date.now() });
  saveState_(state);
  return updateCard_(threadCard_(ctx, state, "Draft discarded."));
}

/** Start this thread's registry over. */
function actionReset(e) {
  var ctx = openContext_(e);
  var store = PropertiesService.getUserProperties();
  uncleKeysForThread(ctx.threadId, Object.keys(store.getProperties())).forEach(function (k) {
    store.deleteProperty(k);
  });
  return updateCard_(threadCard_(ctx, uncleNewState(ctx.threadId), "This thread's Uncle Registry was cleared."));
}

/** Back from an error card, or reload after reading the thread again. */
function actionRefresh(e) {
  var ctx = openContext_(e);
  var loaded = loadSynced_(ctx);
  return updateCard_(threadCard_(ctx, loaded.state, loaded.notice));
}

/* ---------- Gmail ---------- */

/** The open message, its thread and the thread as prompt messages. */
function openContext_(e) {
  e = e || {};
  var g = e.gmail || {};
  var meta = e.messageMetadata || {};
  var token = g.accessToken || meta.accessToken;
  var messageId = g.messageId || meta.messageId || param_(e, "messageId");
  if (!messageId) throw new Error("No email is open.");
  if (token) GmailApp.setCurrentMessageAccessToken(token);
  var message = GmailApp.getMessageById(messageId);
  var thread = message.getThread();
  var gmailMessages = thread.getMessages();
  var raw = gmailMessages.map(function (m) {
    return { id: m.getId(), from: m.getFrom(), date: m.getDate().getTime(), body: m.getPlainBody(), isDraft: m.isDraft() };
  });
  var messages = uncleThreadMessages(raw, myEmails_());
  var lastThem = null;
  for (var i = messages.length - 1; i >= 0; i--) {
    if (messages[i].from === "them") {
      lastThem = messages[i];
      break;
    }
  }
  var replyTarget = null;
  if (lastThem) {
    for (var j = 0; j < gmailMessages.length; j++) if (gmailMessages[j].getId() === lastThem.id) replyTarget = gmailMessages[j];
  }
  return {
    messageId: messageId,
    message: message,
    thread: thread,
    threadId: thread.getId(),
    subject: thread.getFirstMessageSubject() || "",
    counterparty: lastThem ? lastThem.senderName : "",
    messages: messages,
    replyTarget: replyTarget,
  };
}

/** Addresses that count as "you". Add more (aliases) in Script property MY_EMAILS, comma-separated. */
function myEmails_() {
  var out = [];
  try { out.push(Session.getActiveUser().getEmail()); } catch (err) { /* not available */ }
  try { out.push(Session.getEffectiveUser().getEmail()); } catch (err) { /* not available */ }
  var extra = PropertiesService.getScriptProperties().getProperty("MY_EMAILS") || "";
  return out.concat(extra.split(",")).map(function (s) { return String(s || "").trim().toLowerCase(); }).filter(Boolean);
}

/* ---------- Storage ---------- */

/** Load this thread's state and apply the auto-canon rule. Saves when it changed. */
function loadSynced_(ctx) {
  var store = PropertiesService.getUserProperties();
  var state = uncleDecodeState(ctx.threadId, function (k) { return store.getProperty(k); });
  var synced = uncleSyncState(state, ctx.messages, Date.now());
  var notice = "";
  if (synced.committed) {
    saveState_(synced.state);
    notice = "A newer message arrived, so your last draft's registry changes are now canon.";
  }
  return { state: synced.state, notice: notice };
}

function saveState_(state) {
  var store = PropertiesService.getUserProperties();
  try {
    var plan = unclePlanSave(state, store.getProperties());
    var own = uncleStateKey(state.threadId);
    plan.remove.filter(function (k) { return k !== own && k.indexOf(own + ":") !== 0; }).forEach(function (k) { store.deleteProperty(k); });
    store.setProperties(plan.set);
    plan.remove.filter(function (k) { return k === own || k.indexOf(own + ":") === 0; }).forEach(function (k) { store.deleteProperty(k); });
    return { ok: true, evicted: plan.evicted };
  } catch (err) {
    return { ok: false, error: errMessage_(err), evicted: [] };
  }
}

function saveNotice_(saved) {
  if (!saved.ok) return "Could not save this thread's registry (" + saved.error + "). The draft below still works.";
  if (saved.evicted.length) return "Storage was full, so the registries of " + saved.evicted.length + " older thread(s) were removed.";
  return "";
}

/* ---------- Anthropic ---------- */

function readConfig_() {
  var props = PropertiesService.getScriptProperties();
  var apiKey = String(props.getProperty("ANTHROPIC_API_KEY") || "").trim();
  var model = String(props.getProperty("ANTHROPIC_MODEL") || "").trim() || UNCLE_DEFAULT_MODEL;
  return { apiKey: apiKey || null, model: model };
}

function anthropicSend_(apiKey) {
  function post(body) {
    var res = UrlFetchApp.fetch(UNCLE_API_URL, {
      method: "post",
      contentType: "application/json",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      payload: JSON.stringify(body),
      muteHttpExceptions: true,
    });
    return { code: res.getResponseCode(), text: res.getContentText() };
  }
  return function (body) {
    var r = post(body);
    var retry = uncleWithoutThinking(body, r.code, r.text);
    if (retry) r = post(retry);
    if (r.code !== 200) throw new Error(uncleApiErrorMessage(r.code, r.text));
    return JSON.parse(r.text);
  };
}

/* ---------- Cards ---------- */

function threadCard_(ctx, state, notice) {
  var config = readConfig_();
  var preview = unclePreviewRegistry(state);
  var card = CardService.newCardBuilder().setHeader(header_(uncleStatusLine(preview), ctx.subject || "(no subject)"));
  card.setName("thread");

  if (notice) card.addSection(CardService.newCardSection().addWidget(text_(notice)));
  if (!config.apiKey) card.addSection(setupSection_(config));

  var lastFromThem = ctx.messages.length && ctx.messages[ctx.messages.length - 1].from === "them";
  var params = { messageId: ctx.messageId };

  // Reply
  var reply = CardService.newCardSection().setHeader("Reply");
  reply.addWidget(levelInput_(state.pending ? state.pending.level : state.level));
  if (state.pending) {
    reply.addWidget(
      CardService.newTextInput().setFieldName("reply").setTitle("Draft reply (edit freely)").setMultiline(true).setValue(state.pending.text),
    );
    reply.addWidget(
      CardService.newButtonSet()
        .addButton(
          CardService.newTextButton()
            .setText("Create Gmail draft")
            .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
            .setComposeAction(action_("actionCreateDraft", params), CardService.ComposedEmailType.REPLY_AS_DRAFT),
        )
        .addButton(button_("Complicate matters", action_("actionGenerate", Object.assign({ mode: "complicate" }, params), true))),
    );
    reply.addWidget(
      text_(
        state.pending.draftCreated
          ? "Draft created. Send it from Gmail, then tap \"I sent it\". The registry also updates on its own when they reply."
          : "Changes marked (in draft) become canon once you send this reply: tap \"I sent it\", or it happens on its own when they reply.",
      ),
    );
    reply.addWidget(
      CardService.newButtonSet()
        .addButton(button_("I sent it", action_("actionMarkSent", params)))
        .addButton(button_("Discard draft", action_("actionDiscard", params))),
    );
  } else if (lastFromThem) {
    reply.addWidget(
      CardService.newButtonSet()
        .addButton(
          CardService.newTextButton()
            .setText("Generate reply")
            .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
            .setOnClickAction(action_("actionGenerate", Object.assign({ mode: "generate" }, params), true)),
        ),
    );
  } else {
    reply.addWidget(text_("The latest message is yours. When they reply, open their email to draft the next one."));
  }
  card.addSection(reply);

  // Registry
  registrySections_(state.registry, preview).forEach(function (s) { card.addSection(s); });

  card.addSection(
    CardService.newCardSection()
      .setCollapsible(true)
      .setHeader("Settings")
      .addWidget(text_("Model: " + esc_(config.model) + ". Stored in your Google account per thread; separate from the web app's browser threads."))
      .addWidget(
        CardService.newButtonSet()
          .addButton(button_("Reload", action_("actionRefresh", params)))
          .addButton(button_("Clear this thread's registry", action_("actionReset", params))),
      ),
  );
  return card.build();
}

function registrySections_(canon, preview) {
  var draftTag = ' <font color="#b06000">(in draft)</font>';
  var canonUncles = {};
  canon.uncles.forEach(function (u) { canonUncles[u.id] = u; });
  var has = function (list, id) { return list.some(function (x) { return x.id === id; }); };

  var uncles = CardService.newCardSection().setHeader("Uncle Registry");
  if (!preview.uncles.length) uncles.addWidget(text_("No uncles yet. The first reply introduces one."));
  preview.uncles.forEach(function (u) {
    var before = canonUncles[u.id];
    var mark = function (item, list) { return esc_(item) + (before && list.indexOf(item) !== -1 ? "" : draftTag); };
    var lines = ["<b>Uncle " + esc_(u.name) + "</b>" + (before ? "" : draftTag) + (u.role ? " · " + esc_(u.role) : "")];
    if (u.authority.length) lines.push("Authority: " + u.authority.map(function (a) { return mark(a, before ? before.authority : []); }).join("; "));
    if (u.traits.length) lines.push("Traits: " + u.traits.map(function (t) { return mark(t, before ? before.traits : []); }).join("; "));
    uncles.addWidget(text_(lines.join("<br>")));
  });

  var details = CardService.newCardSection().setHeader("Disagreements, requests, facts").setCollapsible(true).setNumUncollapsibleWidgets(3);
  var dis = preview.disagreements.map(function (d) {
    return "• " + esc_(d.parties.join(" vs. ") || "Family") + ": " + esc_(d.subject) + (has(canon.disagreements, d.id) ? "" : draftTag);
  });
  details.addWidget(text_("<b>Disagreements</b><br>" + (dis.length ? dis.join("<br>") : "None yet")));
  var req = preview.requests.map(function (r) {
    var old = canon.requests.filter(function (x) { return x.id === r.id; })[0];
    var status = r.status === "resolved" ? (old && old.status === "resolved" ? " (resolved)" : ' <font color="#b06000">(resolved in draft)</font>') : "";
    return "• " + (r.from ? esc_(r.from) + ": " : "") + esc_(r.request) + status + (old ? "" : draftTag);
  });
  details.addWidget(text_("<b>Outstanding requests</b><br>" + (req.length ? req.join("<br>") : "None yet")));
  var facts = preview.facts.map(function (f) { return "• " + esc_(f.text) + (has(canon.facts, f.id) ? "" : draftTag); });
  details.addWidget(text_("<b>Established facts</b><br>" + (facts.length ? facts.join("<br>") : "None yet")));
  return [uncles, details];
}

function levelInput_(selected) {
  var input = CardService.newSelectionInput().setType(CardService.SelectionInputType.DROPDOWN).setTitle("Absurdity").setFieldName("level");
  UNCLE_LEVELS.forEach(function (l) { input.addItem(l.id + ". " + l.label, String(l.id), l.id === Number(selected)); });
  return input;
}

function setupSection_(config) {
  var s = CardService.newCardSection().setHeader("Setup");
  if (config.apiKey) return s.addWidget(text_("Anthropic key found. Model: " + esc_(config.model) + "."));
  return s.addWidget(
    text_(
      "<b>No Anthropic API key yet.</b> In the Apps Script project open Project Settings &gt; Script properties, add <b>ANTHROPIC_API_KEY</b> with your key, then reopen this email.",
    ),
  );
}

function missingKeyCard_() {
  return CardService.newCardBuilder().setHeader(header_("Setup needed", "Per My Last Uncle")).addSection(setupSection_(readConfig_())).build();
}

function errorCard_(title, message, canRetry, mode, messageId) {
  var s = CardService.newCardSection().addWidget(text_(esc_(message)));
  var params = messageId ? { messageId: messageId } : {};
  var buttons = CardService.newButtonSet();
  if (canRetry) buttons.addButton(button_("Try again", action_("actionGenerate", Object.assign({ mode: mode || "generate" }, params), true)));
  buttons.addButton(button_("Back", action_("actionRefresh", params)));
  s.addWidget(buttons);
  return CardService.newCardBuilder().setHeader(header_(title, "Per My Last Uncle")).addSection(s).build();
}

/* ---------- Small helpers ---------- */

function header_(title, subtitle) {
  return CardService.newCardHeader().setTitle(title).setSubtitle(subtitle).setImageUrl(UNCLE_LOGO);
}

function text_(html) {
  return CardService.newTextParagraph().setText(html);
}

function button_(label, action) {
  return CardService.newTextButton().setText(label).setOnClickAction(action);
}

function action_(fn, params, spinner) {
  var a = CardService.newAction().setFunctionName(fn).setParameters(params || {});
  if (spinner) a.setLoadIndicator(CardService.LoadIndicator.SPINNER);
  return a;
}

function updateCard_(card) {
  return CardService.newActionResponseBuilder().setNavigation(CardService.newNavigation().updateCard(card)).build();
}

function notify_(message) {
  return CardService.newActionResponseBuilder().setNotification(CardService.newNotification().setText(message)).build();
}

function formValue_(e, name) {
  var inputs = e && e.commonEventObject && e.commonEventObject.formInputs;
  if (inputs && inputs[name] && inputs[name].stringInputs && inputs[name].stringInputs.value) return inputs[name].stringInputs.value[0];
  if (e && e.formInput && e.formInput[name] !== undefined) return e.formInput[name];
  return null;
}

function param_(e, name) {
  var p = (e && e.parameters) || (e && e.commonEventObject && e.commonEventObject.parameters) || {};
  return p[name] || null;
}

function esc_(s) {
  return String(s === null || s === undefined ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function errMessage_(err) {
  return err && err.message ? err.message : String(err);
}
