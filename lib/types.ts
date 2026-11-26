/** Core data model for threads and the Uncle Registry. */

export type LevelId = 1 | 2 | 3 | 4 | 5;

export interface Uncle {
  /** Stable id, never reassigned once given (e.g. "uncle-1"). */
  id: string;
  /** First name without the "Uncle" prefix, e.g. "Raymond". */
  name: string;
  role: string;
  /** What he controls. Grows over time; never shrinks. */
  authority: string[];
  /** Canon traits (e.g. "Distrusts subscriptions"). Only ever appended. */
  traits: string[];
  introducedTurn: number;
}

export interface Disagreement {
  id: string;
  /** Uncle names involved. */
  parties: string[];
  subject: string;
  introducedTurn: number;
}

export interface OutstandingRequest {
  id: string;
  /** Uncle name who made the request, or null for the family in general. */
  from: string | null;
  request: string;
  status: "open" | "resolved";
  introducedTurn: number;
}

export interface Fact {
  id: string;
  text: string;
  introducedTurn: number;
}

export interface Registry {
  uncles: Uncle[];
  disagreements: Disagreement[];
  requests: OutstandingRequest[];
  facts: Fact[];
}

/** What the model may propose after a turn. Additive only. */
export interface RegistryUpdate {
  newUncles: { name: string; role: string; authority: string[]; traits: string[] }[];
  uncleUpdates: { name: string; addTraits: string[]; addAuthority: string[] }[];
  newFacts: string[];
  newDisagreements: { parties: string[]; subject: string }[];
  newRequests: { from: string | null; request: string }[];
  resolvedRequestIds: string[];
}

export interface Message {
  id: string;
  /** "them" is the salesperson, "me" is a reply the user sent (or marked as sent). */
  from: "them" | "me";
  senderName: string;
  body: string;
  createdAt: string;
}

export interface Draft {
  text: string;
  level: LevelId;
  /** Registry changes that apply once this draft is marked as sent. */
  update: RegistryUpdate;
  createdAt: string;
}

export interface Thread {
  id: string;
  title: string;
  subject: string;
  counterparty: string;
  isSample: boolean;
  level: LevelId;
  messages: Message[];
  registry: Registry;
  draft: Draft | null;
  createdAt: string;
  updatedAt: string;
}

export const emptyRegistry = (): Registry => ({
  uncles: [],
  disagreements: [],
  requests: [],
  facts: [],
});

export const emptyUpdate = (): RegistryUpdate => ({
  newUncles: [],
  uncleUpdates: [],
  newFacts: [],
  newDisagreements: [],
  newRequests: [],
  resolvedRequestIds: [],
});
