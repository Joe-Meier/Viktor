import { describe, expect, it } from "vitest";
import { createSampleThread, SAMPLE_THREAD_ID } from "@/lib/sample";
import { loadState, saveState, STORAGE_KEY } from "@/lib/storage";
import { addTheirReply, commitDraft, createThread } from "@/lib/threads";

class MemoryStore {
  data = new Map<string, string>();
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.data.set(k, v);
  }
}

describe("storage", () => {
  it("starts with the sample thread when nothing is saved", () => {
    const state = loadState(new MemoryStore());
    expect(state.threads).toHaveLength(1);
    expect(state.threads[0].id).toBe(SAMPLE_THREAD_ID);
    expect(state.threads[0].isSample).toBe(true);
    expect(state.activeId).toBe(SAMPLE_THREAD_ID);
  });

  it("round-trips threads, registry and drafts", () => {
    const store = new MemoryStore();
    const sample = commitDraft(createSampleThread());
    const real = createThread({ body: "Hi Joe,\n\nWe sell CRMs.\n\nBest,\nPat Lee", subject: "CRM" });
    saveState(store, { threads: [real, sample], activeId: real.id });
    const loaded = loadState(store);
    expect(loaded).toEqual({ threads: [real, sample], activeId: real.id });
    expect(loaded.threads[1].registry.uncles.map((u) => u.name)).toEqual(["Raymond", "Walt"]);
  });

  it("recovers from corrupt JSON and from other versions", () => {
    const store = new MemoryStore();
    store.setItem(STORAGE_KEY, "{not json");
    expect(loadState(store).threads[0].id).toBe(SAMPLE_THREAD_ID);
    store.setItem(STORAGE_KEY, JSON.stringify({ version: 99, threads: [], activeId: null }));
    expect(loadState(store).threads[0].id).toBe(SAMPLE_THREAD_ID);
  });

  it("skips a single corrupt thread and keeps the rest", () => {
    const store = new MemoryStore();
    const good = createSampleThread();
    store.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: 1, activeId: "missing", threads: [{ id: "broken" }, good] }),
    );
    const loaded = loadState(store);
    expect(loaded.threads.map((t) => t.id)).toEqual([good.id]);
    expect(loaded.activeId).toBe(good.id);
  });

  it("keeps an empty list if the user deleted every thread", () => {
    const store = new MemoryStore();
    saveState(store, { threads: [], activeId: null });
    expect(loadState(store)).toEqual({ threads: [], activeId: null });
  });

  it("survives a storage that throws", () => {
    const throwing = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("full");
      },
    };
    expect(loadState(throwing).threads).toHaveLength(1);
    expect(saveState(throwing, { threads: [], activeId: null })).toBe(false);
  });
});

describe("thread flow", () => {
  it("creates a thread from a pasted email and detects the sender", () => {
    const t = createThread({ body: "Subject: Quick question\n\nHi Joe,\n\nWould you like a demo?\n\nThanks,\nPriya Raman\nAE, Fernwood" });
    expect(t.counterparty).toBe("Priya Raman");
    expect(t.subject).toBe("Quick question");
    expect(t.messages).toHaveLength(1);
    expect(t.registry.uncles).toHaveLength(0);
  });

  it("commits the draft as sent and merges its registry update before their reply", () => {
    const sample = createSampleThread();
    const next = addTheirReply(sample, "Happy to add two initial fields.");
    expect(next.draft).toBeNull();
    expect(next.messages.map((m) => m.from)).toEqual(["them", "me", "them", "me", "them", "me", "them"]);
    expect(next.messages.at(-2)?.body).toBe(sample.draft?.text);
    expect(next.registry.uncles.map((u) => u.name)).toEqual(["Raymond", "Walt"]);
    expect(next.registry.uncles[1].introducedTurn).toBe(3);
    expect(next.registry.disagreements).toHaveLength(1);
  });
});
