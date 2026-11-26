import type Anthropic from "@anthropic-ai/sdk";
import { buildUserPrompt, SYSTEM_PROMPT, type PromptInput } from "./prompt";
import { modelOutputSchema, type ModelOutput } from "./schema";

export const DEFAULT_MODEL = "claude-sonnet-5-5";

export class GenerationError extends Error {
  constructor(
    message: string,
    readonly code: "bad_output" | "upstream_error",
  ) {
    super(message);
  }
}

type MessagesClient = Pick<Anthropic, "messages">;

const EMOJI = /\p{Extended_Pictographic}/u;

/** Pull the JSON object out of the model's text, tolerating code fences or stray prose. */
export function extractJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start === -1 || end <= start) throw new Error("No JSON object in the response.");
    return JSON.parse(trimmed.slice(start, end + 1));
  }
}

/** Parse and check one model response. Returns the output or a reason it was rejected. */
export function parseModelOutput(text: string): { ok: true; value: ModelOutput } | { ok: false; reason: string } {
  let raw: unknown;
  try {
    raw = extractJson(text);
  } catch (e) {
    return { ok: false, reason: `The response was not valid JSON (${(e as Error).message}).` };
  }
  const parsed = modelOutputSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, reason: `The JSON did not match the required shape: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}.` };
  }
  const value = parsed.data;
  if (value.registry.newUncles.length > 1) {
    return { ok: false, reason: "It introduced more than one new uncle. Introduce at most one." };
  }
  if (EMOJI.test(value.reply)) {
    return { ok: false, reason: "The reply contained an emoji. Use plain text only." };
  }
  return { ok: true, value: { ...value, reply: value.reply.trim() } };
}

function textOf(response: Anthropic.Message): string {
  return response.content
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("")
    .trim();
}

/**
 * Ask the model for a reply and a registry update. One retry on unusable output,
 * telling the model what was wrong with its first answer.
 */
export async function generateReply(
  client: MessagesClient,
  model: string,
  input: PromptInput,
): Promise<ModelOutput> {
  const userPrompt = buildUserPrompt(input);
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: userPrompt }];
  let lastReason = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    let response: Anthropic.Message;
    try {
      response = await client.messages.create({
        model,
        max_tokens: 1500,
        system: SYSTEM_PROMPT,
        messages,
      });
    } catch (e) {
      throw new GenerationError(`The model request failed: ${(e as Error).message}`, "upstream_error");
    }
    const text = textOf(response);
    const result: ReturnType<typeof parseModelOutput> =
      response.stop_reason === "max_tokens"
        ? { ok: false, reason: "The response was cut off before the JSON was complete. Keep it shorter." }
        : parseModelOutput(text);
    if (result.ok) return result.value;
    lastReason = result.reason;
    messages.push(
      { role: "assistant", content: text || "(empty)" },
      {
        role: "user",
        content: `That output could not be used: ${result.reason} Return only the JSON object described in the instructions, nothing else.`,
      },
    );
  }
  throw new GenerationError(`The model returned unusable output twice. ${lastReason}`, "bad_output");
}
