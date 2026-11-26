import type { Registry, RegistryUpdate, Uncle } from "./types";

/** "Uncle Raymond" -> "Raymond"; trims whitespace. */
export function cleanUncleName(name: string): string {
  return name.trim().replace(/^uncle\s+/i, "").trim();
}

const key = (s: string) => cleanUncleName(s).toLowerCase().replace(/\s+/g, " ");
const textKey = (s: string) =>
  s.trim().toLowerCase().replace(/[.\s]+$/g, "").replace(/\s+/g, " ");

function appendUnique(list: string[], additions: string[]): string[] {
  const seen = new Set(list.map(textKey));
  const out = [...list];
  for (const raw of additions) {
    const item = raw.trim();
    if (!item || seen.has(textKey(item))) continue;
    seen.add(textKey(item));
    out.push(item);
  }
  return out;
}

function nextId(prefix: string, ids: string[]): string {
  let max = 0;
  for (const id of ids) {
    const m = id.match(new RegExp(`^${prefix}-(\\d+)$`));
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}-${max + 1}`;
}

export function findUncle(registry: Registry, name: string): Uncle | undefined {
  const k = key(name);
  return registry.uncles.find((u) => key(u.name) === k);
}

/**
 * Merge a proposed update into the registry.
 *
 * Canon is append-only: existing uncles keep their id, name, role and every trait and
 * authority they already had; facts, disagreements and requests are never removed or
 * rewritten. The only state change allowed on existing canon is marking an open request
 * as resolved. Returns a new registry; the input is not mutated.
 */
export function mergeRegistry(
  registry: Registry,
  update: RegistryUpdate,
  turn: number,
): Registry {
  const uncles = registry.uncles.map((u) => ({
    ...u,
    authority: [...u.authority],
    traits: [...u.traits],
  }));
  const byKey = new Map(uncles.map((u) => [key(u.name), u]));

  const addToExisting = (u: Uncle, traits: string[], authority: string[]) => {
    u.traits = appendUnique(u.traits, traits);
    u.authority = appendUnique(u.authority, authority);
  };

  for (const proposed of update.newUncles) {
    const name = cleanUncleName(proposed.name);
    if (!name) continue;
    const existing = byKey.get(key(name));
    if (existing) {
      // Re-introducing a known uncle never resets him; it only adds detail.
      addToExisting(existing, proposed.traits, proposed.authority);
      continue;
    }
    const uncle: Uncle = {
      id: nextId("uncle", uncles.map((u) => u.id)),
      name,
      role: proposed.role.trim(),
      authority: appendUnique([], proposed.authority),
      traits: appendUnique([], proposed.traits),
      introducedTurn: turn,
    };
    uncles.push(uncle);
    byKey.set(key(name), uncle);
  }

  for (const change of update.uncleUpdates) {
    const existing = byKey.get(key(change.name));
    if (existing) addToExisting(existing, change.addTraits, change.addAuthority);
  }

  const canonicalName = (n: string) => byKey.get(key(n))?.name ?? cleanUncleName(n);

  const facts = [...registry.facts];
  const factKeys = new Set(facts.map((f) => textKey(f.text)));
  for (const raw of update.newFacts) {
    const text = raw.trim();
    if (!text || factKeys.has(textKey(text))) continue;
    factKeys.add(textKey(text));
    facts.push({ id: nextId("fact", facts.map((f) => f.id)), text, introducedTurn: turn });
  }

  const disagreements = [...registry.disagreements];
  const disKey = (parties: string[], subject: string) =>
    `${[...parties].map(key).sort().join("|")}::${textKey(subject)}`;
  const disKeys = new Set(disagreements.map((d) => disKey(d.parties, d.subject)));
  for (const d of update.newDisagreements) {
    const subject = d.subject.trim();
    const parties = d.parties.map(canonicalName).filter(Boolean);
    if (!subject || disKeys.has(disKey(parties, subject))) continue;
    disKeys.add(disKey(parties, subject));
    disagreements.push({
      id: nextId("dispute", disagreements.map((x) => x.id)),
      parties,
      subject,
      introducedTurn: turn,
    });
  }

  const resolved = new Set(update.resolvedRequestIds);
  const requests = registry.requests.map((r) =>
    resolved.has(r.id) ? { ...r, status: "resolved" as const } : { ...r },
  );
  const reqKeys = new Set(requests.map((r) => textKey(r.request)));
  for (const r of update.newRequests) {
    const request = r.request.trim();
    if (!request || reqKeys.has(textKey(request))) continue;
    reqKeys.add(textKey(request));
    requests.push({
      id: nextId("request", requests.map((x) => x.id)),
      from: r.from ? canonicalName(r.from) : null,
      request,
      status: "open",
      introducedTurn: turn,
    });
  }

  return { uncles, disagreements, requests, facts };
}

/** "Procurement currently involves 3 uncles." */
export function statusLine(registry: Registry): string {
  const n = registry.uncles.length;
  if (n === 0) return "Procurement currently involves no uncles.";
  return `Procurement currently involves ${n} ${n === 1 ? "uncle" : "uncles"}.`;
}
