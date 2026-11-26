// Runs the add-on's .gs files under Node the way Apps Script does: one shared global
// scope, with stand-ins for CardService, GmailApp, PropertiesService, UrlFetchApp and
// Session. Used by the repo's tests and by dev/live-check.mjs. Not part of the add-on.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ADDON_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const ADDON_FILES = ["Shared.gs", "Code.gs"];

/** Builders record every call; build() returns the record. */
function builder(kind) {
  const rec = { kind, calls: [] };
  const proxy = new Proxy(rec, {
    get(target, prop) {
      if (prop === "__rec") return rec;
      if (prop === "build") return () => rec;
      return (...args) => {
        rec.calls.push([prop, args.map((a) => (a && a.__rec ? a.__rec : a))]);
        return proxy;
      };
    },
  });
  return proxy;
}

const cardService = new Proxy(
  {},
  {
    get(_, prop) {
      if (typeof prop === "string" && prop.startsWith("new")) return () => builder(prop.slice(3));
      return new Proxy({}, { get: (_t, v) => `${String(prop)}.${String(v)}` });
    },
  },
);

/** Apps Script user/script properties with the real size limits (9 KB a value, 500 KB total). */
export class FakeProperties {
  constructor(init = {}) {
    this.map = new Map(Object.entries(init));
  }
  getProperty(k) {
    return this.map.has(k) ? this.map.get(k) : null;
  }
  getProperties() {
    return Object.fromEntries(this.map);
  }
  setProperty(k, v) {
    return this.setProperties({ [k]: v });
  }
  setProperties(obj) {
    const next = new Map(this.map);
    for (const [k, v] of Object.entries(obj)) {
      if (Buffer.byteLength(String(v)) > 9 * 1024) throw new Error("Exceeded maximum stored value size.");
      next.set(k, String(v));
    }
    let total = 0;
    for (const [k, v] of next) total += Buffer.byteLength(k) + Buffer.byteLength(v);
    if (total > 500 * 1024) throw new Error("You have exceeded the property storage quota.");
    this.map = next;
    return this;
  }
  deleteProperty(k) {
    this.map.delete(k);
    return this;
  }
}

/** A Gmail thread: messages [{ id, from, date (ms), body, isDraft? }]. */
/**
 * @param {string} threadId @param {string} subject @param {Array<Record<string, any>>} messages @param {string} me
 * @returns {any}
 */
export function fakeGmail(threadId, subject, messages, me) {
  const thread = {
    drafts: [],
    getId: () => threadId,
    getFirstMessageSubject: () => subject,
    getMessages: () => messages.map(wrap),
  };
  function wrap(m) {
    return {
      getId: () => m.id,
      getFrom: () => m.from,
      getDate: () => new Date(m.date),
      getPlainBody: () => m.body,
      isDraft: () => !!m.isDraft,
      getThread: () => thread,
      createDraftReply: (text) => {
        const draft = { id: `draft-${thread.drafts.length + 1}`, from: me, date: Date.now(), body: text, isDraft: true, replyTo: m.id };
        thread.drafts.push(draft);
        messages.push(draft);
        return { getId: () => draft.id, __draft: draft };
      },
    };
  }
  return {
    thread,
    messages,
    GmailApp: {
      setCurrentMessageAccessToken() {},
      getMessageById(id) {
        const m = messages.find((x) => x.id === id);
        if (!m) throw new Error(`No message ${id}`);
        return wrap(m);
      },
    },
  };
}

/**
 * Load the add-on. fetch(url, options) -> { code, text } stands in for UrlFetchApp.
 * Returns the global scope (every add-on function) plus the stand-ins.
 */
/**
 * @param {{ gmail?: any, scriptProps?: Record<string, string>, userProps?: any, fetch?: (url: string, options: any) => { code: number, text: string }, me?: string }} [opts]
 * @returns {{ g: any, user: FakeProperties, script: FakeProperties, fetches: Array<{ url: string, options: any }> }}
 */
export function loadAddon({ gmail, scriptProps = {}, userProps, fetch, me = "joe@joemeier.cool" } = {}) {
  const user = userProps instanceof FakeProperties ? userProps : new FakeProperties(userProps);
  const script = new FakeProperties(scriptProps);
  const fetches = [];
  const context = {
    console,
    CardService: cardService,
    GmailApp: gmail ? gmail.GmailApp : undefined,
    PropertiesService: { getUserProperties: () => user, getScriptProperties: () => script },
    Session: { getActiveUser: () => ({ getEmail: () => me }), getEffectiveUser: () => ({ getEmail: () => me }) },
    UrlFetchApp: {
      fetch(url, options) {
        fetches.push({ url, options });
        if (!fetch) throw new Error("No fetch stub");
        const r = fetch(url, options);
        return { getResponseCode: () => r.code, getContentText: () => r.text };
      },
    },
  };
  vm.createContext(context);
  for (const f of ADDON_FILES) vm.runInContext(fs.readFileSync(path.join(ADDON_DIR, f), "utf8"), context, { filename: f });
  return { g: context, user, script, fetches };
}

/* ---------- Reading recorded cards ---------- */

/** @param {any} rec @param {(r: any) => void} visit */
export function walk(rec, visit) {
  if (!rec || typeof rec !== "object") return;
  if (Array.isArray(rec)) return rec.forEach((r) => walk(r, visit));
  if (rec.kind) visit(rec);
  for (const [, args] of rec.calls || []) walk(args, visit);
  if (!rec.kind) for (const v of Object.values(rec)) walk(v, visit);
}

const arg = (rec, method) => rec.calls.find(([m]) => m === method)?.[1];

/** The card inside an ActionResponse (updateCard), or the card itself. */
/** @param {any} response @returns {any} */
export function cardOf(response) {
  if (response.kind === "Card" || response.kind === "CardBuilder") return response;
  let card = null;
  walk(response, (r) => {
    if (r.kind === "Navigation") card = arg(r, "updateCard")?.[0] ?? card;
  });
  return card;
}

/** @param {any} response @returns {string | null} */
export function notificationOf(response) {
  let text = null;
  walk(response, (r) => {
    if (r.kind === "Notification") text = arg(r, "setText")?.[0] ?? text;
  });
  return text;
}

/** All visible text on a card, HTML tags stripped. */
/** @param {any} card @returns {string} */
export function cardText(card) {
  const out = [];
  walk(card, (r) => {
    for (const [m, args] of r.calls) {
      if (["setText", "setTitle", "setSubtitle", "setHeader", "setValue"].includes(m) && typeof args[0] === "string") out.push(args[0]);
      if (m === "addItem") out.push(String(args[0]));
    }
  });
  return out.join("\n").replace(/<br>/g, "\n").replace(/<[^>]+>/g, "").replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&");
}

/** @param {any} card @returns {Array<{ label: string, compose: boolean, composeType: any, fn: string | null, params: Record<string, string> }>} */
export function buttons(card) {
  const out = [];
  walk(card, (r) => {
    if (r.kind !== "TextButton") return;
    const click = arg(r, "setOnClickAction") || arg(r, "setComposeAction");
    const action = click?.[0];
    out.push({
      label: arg(r, "setText")?.[0],
      compose: !!arg(r, "setComposeAction"),
      composeType: arg(r, "setComposeAction")?.[1],
      fn: action ? arg(action, "setFunctionName")?.[0] : null,
      params: action ? (arg(action, "setParameters")?.[0] ?? {}) : {},
    });
  });
  return out;
}

/** Current form values: the reply text field and the selected absurdity level. */
/** @param {any} card @returns {Record<string, string>} */
export function formOf(card) {
  const form = {};
  walk(card, (r) => {
    if (r.kind === "TextInput") form[arg(r, "setFieldName")[0]] = arg(r, "setValue")?.[0] ?? "";
    if (r.kind === "SelectionInput") {
      const sel = r.calls.find(([m, a]) => m === "addItem" && a[2]);
      form[arg(r, "setFieldName")[0]] = sel ? sel[1][1] : "";
    }
  });
  return form;
}

/** @param {string} messageId @param {Record<string, string>} [params] @param {Record<string, string>} [form] @returns {any} */
export function event(messageId, params = {}, form = {}) {
  const formInputs = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, { stringInputs: { value: [String(v)] } }]));
  return {
    gmail: { messageId, accessToken: "test-token" },
    parameters: params,
    formInput: form,
    commonEventObject: { parameters: params, formInputs },
  };
}

/** Press a button on a card the way Gmail would: same function, parameters and form values. */
/** @param {any} addon @param {any} card @param {string} label @param {Record<string, string>} [overrides] @returns {any} */
export function click(addon, card, label, overrides = {}) {
  const b = buttons(card).find((x) => x.label === label);
  if (!b) throw new Error(`No "${label}" button. Buttons: ${buttons(card).map((x) => x.label).join(", ")}`);
  const fn = addon.g[b.fn];
  if (typeof fn !== "function") throw new Error(`Button "${label}" calls missing function ${b.fn}`);
  return fn(event(b.params.messageId, b.params, { ...formOf(card), ...overrides }));
}
