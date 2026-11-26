import { describe, expect, it } from "vitest";
import { cleanUncleName, mergeRegistry, statusLine } from "@/lib/registry";
import { createSampleThread } from "@/lib/sample";
import { emptyRegistry, emptyUpdate, type Registry } from "@/lib/types";

const base = (): Registry => createSampleThread().registry;

describe("mergeRegistry", () => {
  it("keeps every existing uncle, trait, fact and request", () => {
    const before = base();
    const after = mergeRegistry(before, { ...emptyUpdate(), newFacts: ["Walt lives in Tucson."] }, 3);
    expect(after.uncles).toEqual(before.uncles);
    expect(after.requests).toEqual(before.requests);
    expect(after.facts.slice(0, before.facts.length)).toEqual(before.facts);
  });

  it("does not mutate its input", () => {
    const before = base();
    const snapshot = JSON.parse(JSON.stringify(before));
    mergeRegistry(
      before,
      {
        ...emptyUpdate(),
        uncleUpdates: [{ name: "Raymond", addTraits: ["Prefers fountain pens"], addAuthority: [] }],
        resolvedRequestIds: ["request-1"],
      },
      3,
    );
    expect(before).toEqual(snapshot);
  });

  it("adds a new uncle with the next id and the turn he appeared", () => {
    const after = mergeRegistry(
      base(),
      {
        ...emptyUpdate(),
        newUncles: [{ name: "Uncle Walt", role: "Signatory", authority: ["Tucson"], traits: ["Green ink"] }],
      },
      3,
    );
    expect(after.uncles.map((u) => [u.id, u.name])).toEqual([
      ["uncle-1", "Raymond"],
      ["uncle-2", "Walt"],
    ]);
    expect(after.uncles[1].introducedTurn).toBe(3);
  });

  it("never duplicates an uncle the model re-introduces, and never resets him", () => {
    const after = mergeRegistry(
      base(),
      {
        ...emptyUpdate(),
        newUncles: [
          { name: "uncle raymond", role: "Treasurer", authority: [], traits: ["Loves subscriptions", "Owns a fax machine"] },
        ],
      },
      3,
    );
    expect(after.uncles).toHaveLength(1);
    const raymond = after.uncles[0];
    expect(raymond.id).toBe("uncle-1");
    expect(raymond.role).toBe("Head of approvals");
    expect(raymond.traits[0]).toBe("Does not enter into subscriptions, as a matter of principle");
    expect(raymond.traits).toContain("Owns a fax machine");
  });

  it("appends facts in order without duplicates", () => {
    const after = mergeRegistry(
      base(),
      {
        ...emptyUpdate(),
        newFacts: ["Approvals are currently handled verbally", "The lake house has no fax.", "The lake house has no fax."],
      },
      3,
    );
    expect(after.facts.map((f) => f.text)).toEqual([
      "Approvals are currently handled verbally.",
      "Raymond has reviewed the Ledgerline overview deck.",
      "A walkthrough is planned for Thursday at 2pm.",
      "The lake house has no fax.",
    ]);
    expect(after.facts[3].id).toBe("fact-4");
  });

  it("adds traits and authority to existing uncles, ignoring unknown names", () => {
    const after = mergeRegistry(
      base(),
      {
        ...emptyUpdate(),
        uncleUpdates: [
          { name: "Raymond", addTraits: ["Reads only on Sundays", "Initials a printed copy of every invoice"], addAuthority: ["Vendor mail"] },
          { name: "Ghost", addTraits: ["Imaginary"], addAuthority: [] },
        ],
      },
      3,
    );
    expect(after.uncles).toHaveLength(1);
    expect(after.uncles[0].traits).toEqual([
      "Does not enter into subscriptions, as a matter of principle",
      "Initials a printed copy of every invoice",
      "Reads only on Sundays",
    ]);
    expect(after.uncles[0].authority).toContain("Vendor mail");
  });

  it("records disagreements and requests, and only resolves known requests", () => {
    const withWalt = mergeRegistry(
      base(),
      { ...emptyUpdate(), newUncles: [{ name: "Walt", role: "", authority: [], traits: [] }] },
      3,
    );
    const after = mergeRegistry(
      withWalt,
      {
        ...emptyUpdate(),
        newDisagreements: [{ parties: ["uncle raymond", "Walt"], subject: "Green ink" }],
        newRequests: [{ from: "Uncle Walt", request: "Send two proposals" }],
        resolvedRequestIds: ["request-2", "request-99"],
      },
      4,
    );
    expect(after.disagreements).toEqual([
      { id: "dispute-1", parties: ["Raymond", "Walt"], subject: "Green ink", introducedTurn: 4 },
    ]);
    expect(after.requests.find((r) => r.id === "request-2")?.status).toBe("resolved");
    expect(after.requests.find((r) => r.id === "request-1")?.status).toBe("open");
    expect(after.requests.at(-1)).toMatchObject({ id: "request-3", from: "Walt", request: "Send two proposals", status: "open" });
  });
});

describe("helpers", () => {
  it("stores new registry entries in sentence case", () => {
    const after = mergeRegistry(
      emptyRegistry(),
      {
        ...emptyUpdate(),
        newUncles: [{ name: "Walt", role: "keeps the minutes", authority: ["vendor mail"], traits: ["prefers paper"] }],
        newFacts: ["the cabin has no internet"],
      },
      1,
    );
    expect(after.uncles[0]).toMatchObject({ role: "Keeps the minutes", authority: ["Vendor mail"], traits: ["Prefers paper"] });
    expect(after.facts[0].text).toBe("The cabin has no internet");
  });

  it("cleans uncle names", () => {
    expect(cleanUncleName("  Uncle  Raymond ")).toBe("Raymond");
    expect(cleanUncleName("Walt")).toBe("Walt");
  });

  it("writes the status line", () => {
    expect(statusLine(emptyRegistry())).toBe("Procurement currently involves no uncles.");
    expect(statusLine(base())).toBe("Procurement currently involves 1 uncle.");
    const three = mergeRegistry(
      base(),
      {
        ...emptyUpdate(),
        newUncles: [
          { name: "Walt", role: "", authority: [], traits: [] },
          { name: "Lionel", role: "", authority: [], traits: [] },
        ],
      },
      3,
    );
    expect(statusLine(three)).toBe("Procurement currently involves 3 uncles.");
  });
});
