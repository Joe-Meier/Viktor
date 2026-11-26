import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSampleThread } from "@/lib/sample";
import { DEFAULT_MODEL } from "@/lib/generate";

const create = vi.fn();
const constructed: unknown[] = [];

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create };
    constructor(opts: unknown) {
      constructed.push(opts);
    }
  },
}));

const { POST } = await import("@/app/api/reply/route");
const { GET } = await import("@/app/api/status/route");

const text = (t: string) => ({ content: [{ type: "text", text: t }] });

const goodOutput = {
  reply:
    "Hi Dana,\n\nThank you for the approval sheet. My uncle Walt has asked whether it can be signed in green ink.",
  registry: {
    newUncles: [{ name: "Walt", role: "Signatory", authority: ["Tucson"], traits: ["Green ink only"] }],
    newFacts: ["Walt handles Tucson."],
  },
};

function requestFor(body: unknown) {
  return new Request("http://localhost/api/reply", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function sampleBody() {
  const t = createSampleThread();
  return {
    subject: t.subject,
    counterparty: t.counterparty,
    messages: t.messages,
    registry: t.registry,
    level: 3,
  };
}

describe("POST /api/reply", () => {
  beforeEach(() => {
    create.mockReset();
    constructed.length = 0;
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.stubEnv("ANTHROPIC_MODEL", "");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns the reply and a normalized registry update", async () => {
    create.mockResolvedValueOnce(text(JSON.stringify(goodOutput)));
    const res = await POST(requestFor(sampleBody()));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.reply).toBe(goodOutput.reply);
    expect(data.update.newUncles[0].name).toBe("Walt");
    expect(data.update.uncleUpdates).toEqual([]);
    expect(data.update.resolvedRequestIds).toEqual([]);
    expect(create).toHaveBeenCalledTimes(1);
    expect(constructed[0]).toMatchObject({ apiKey: "test-key" });

    const call = create.mock.calls[0][0];
    expect(call.model).toBe(DEFAULT_MODEL);
    expect(call.system).toContain("Uncle Registry you are given is canon");
    const prompt = call.messages[0].content as string;
    expect(prompt).toContain("Does not enter into subscriptions");
    expect(prompt).toContain("ABSURDITY LEVEL 3 of 5: Overlapping jurisdictions");
    expect(prompt).toContain("reply number 3");
  });

  it("uses ANTHROPIC_MODEL when set", async () => {
    vi.stubEnv("ANTHROPIC_MODEL", "claude-custom");
    create.mockResolvedValueOnce(text(JSON.stringify(goodOutput)));
    await POST(requestFor(sampleBody()));
    expect(create.mock.calls[0][0].model).toBe("claude-custom");
  });

  it("accepts JSON wrapped in a code fence", async () => {
    create.mockResolvedValueOnce(text("```json\n" + JSON.stringify(goodOutput) + "\n```"));
    const res = await POST(requestFor(sampleBody()));
    expect(res.status).toBe(200);
  });

  it("retries once when the first output is not valid JSON", async () => {
    create
      .mockResolvedValueOnce(text("Sure! Here is a reply: Hi Dana..."))
      .mockResolvedValueOnce(text(JSON.stringify(goodOutput)));
    const res = await POST(requestFor(sampleBody()));
    expect(res.status).toBe(200);
    expect((await res.json()).reply).toBe(goodOutput.reply);
    expect(create).toHaveBeenCalledTimes(2);
    const retry = create.mock.calls[1][0].messages;
    expect(retry).toHaveLength(3);
    expect(retry[1].role).toBe("assistant");
    expect(retry[2].content).toContain("not valid JSON");
  });

  it("retries when the output introduces more than one uncle", async () => {
    const tooMany = {
      ...goodOutput,
      registry: {
        newUncles: [
          { name: "Walt", role: "", authority: [], traits: [] },
          { name: "Lionel", role: "", authority: [], traits: [] },
        ],
      },
    };
    create
      .mockResolvedValueOnce(text(JSON.stringify(tooMany)))
      .mockResolvedValueOnce(text(JSON.stringify(goodOutput)));
    const res = await POST(requestFor(sampleBody()));
    expect(res.status).toBe(200);
    expect(create.mock.calls[1][0].messages[2].content).toContain("more than one new uncle");
  });

  it("gives up with a clear error after two bad outputs", async () => {
    create.mockResolvedValue(text("not json"));
    const res = await POST(requestFor(sampleBody()));
    expect(res.status).toBe(502);
    const data = await res.json();
    expect(data.code).toBe("bad_output");
    expect(data.error).toContain("unusable output twice");
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("reports upstream failures", async () => {
    create.mockRejectedValueOnce(new Error("overloaded"));
    const res = await POST(requestFor(sampleBody()));
    expect(res.status).toBe(502);
    expect((await res.json()).code).toBe("upstream_error");
  });

  it("explains how to add the key when ANTHROPIC_API_KEY is missing", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const res = await POST(requestFor(sampleBody()));
    expect(res.status).toBe(503);
    const data = await res.json();
    expect(data.code).toBe("missing_api_key");
    expect(data.error).toContain("ANTHROPIC_API_KEY");
    expect(data.error).toContain(".env.local");
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects malformed requests without calling the model", async () => {
    const res = await POST(requestFor({ messages: [] }));
    expect(res.status).toBe(400);
    const notJson = await POST(
      new Request("http://localhost/api/reply", { method: "POST", body: "{" }),
    );
    expect(notJson.status).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  it("refuses to draft when the latest message is already the user's", async () => {
    const body = sampleBody();
    body.messages = body.messages.slice(0, 2);
    const res = await POST(requestFor(body));
    expect(res.status).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });
});

describe("GET /api/status", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("reports a missing key", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const data = await (await GET()).json();
    expect(data.configured).toBe(false);
    expect(data.message).toContain(".env.local");
  });

  it("reports a configured key without exposing it", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "secret-value");
    const res = await GET();
    const raw = await res.text();
    expect(JSON.parse(raw).configured).toBe(true);
    expect(raw).not.toContain("secret-value");
  });
});
