import { describe, expect, it } from "vitest";
import { getLevel, LEVELS } from "@/lib/escalation";
import { buildUserPrompt, formatRegistry, SYSTEM_PROMPT, turnNumber } from "@/lib/prompt";
import { createSampleThread } from "@/lib/sample";
import { emptyRegistry } from "@/lib/types";

describe("escalation levels", () => {
  it("has five levels from minor involvement to constitutional crisis", () => {
    expect(LEVELS.map((l) => l.id)).toEqual([1, 2, 3, 4, 5]);
    expect(LEVELS[0].label).toBe("Minor family involvement");
    expect(LEVELS[4].label).toBe("Constitutional uncle crisis");
  });

  it("falls back to level 1 for unknown ids", () => {
    expect(getLevel(9).id).toBe(1);
  });
});

describe("prompt building", () => {
  const sample = createSampleThread();
  const input = {
    subject: sample.subject,
    counterparty: sample.counterparty,
    messages: sample.messages,
    registry: sample.registry,
    level: 4 as const,
  };

  it("includes the level label and guidance", () => {
    const prompt = buildUserPrompt(input);
    expect(prompt).toContain("ABSURDITY LEVEL 4 of 5: Formal family proceedings");
    expect(prompt).toContain(getLevel(4).guidance);
  });

  it("includes canon from the registry", () => {
    const prompt = buildUserPrompt(input);
    expect(prompt).toContain("UNCLE REGISTRY (canon, do not contradict)");
    expect(prompt).toContain("Raymond (uncle-1), Head of approvals");
    expect(prompt).toContain("Does not enter into subscriptions, as a matter of principle");
    expect(prompt).toContain("[request-1] Raymond: Offer Ledgerline as a one-time purchase");
    expect(prompt).toContain("A walkthrough is planned for Thursday at 2pm.");
  });

  it("includes the whole thread in order and the turn number", () => {
    const prompt = buildUserPrompt(input);
    expect(turnNumber(sample.messages)).toBe(3);
    expect(prompt).toContain("reply number 3");
    const first = prompt.indexOf("Message 1, from Dana Whitcombe");
    const fifth = prompt.indexOf("Message 5, from Dana Whitcombe");
    expect(first).toBeGreaterThan(-1);
    expect(fifth).toBeGreaterThan(first);
    expect(prompt).toContain("Message 2, from the user (reply already sent)");
  });

  it("asks for a different take when complicating an existing draft", () => {
    const prompt = buildUserPrompt({ ...input, previousDraft: "Hi Dana, my uncle has a fax." });
    expect(prompt).toContain("COMPLICATE MATTERS");
    expect(prompt).toContain("Hi Dana, my uncle has a fax.");
    expect(buildUserPrompt(input)).not.toContain("COMPLICATE MATTERS");
  });

  it("describes an empty registry", () => {
    expect(formatRegistry(emptyRegistry())).toContain("No uncles have been mentioned yet");
  });

  it("encodes the humor rules in the system prompt", () => {
    for (const rule of [
      "2 to 4 sentences",
      "Respond to the actual pitch",
      "Escalate gradually",
      "at most ONE new uncle",
      "Never contradict it",
      "Do not default to boats",
      "Never explain or comment on the situation",
      "emojis",
    ]) {
      expect(SYSTEM_PROMPT).toContain(rule);
    }
  });
});
