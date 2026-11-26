import Anthropic from "@anthropic-ai/sdk";
import { readConfig, MISSING_KEY_MESSAGE } from "@/lib/config";
import { generateReply, GenerationError } from "@/lib/generate";
import { replyRequestSchema } from "@/lib/schema";

export const runtime = "nodejs";

/** Generate a reply draft and a proposed registry update. Never sends anything. */
export async function POST(request: Request) {
  const { apiKey, model } = readConfig();
  if (!apiKey) {
    return Response.json({ error: MISSING_KEY_MESSAGE, code: "missing_api_key" }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "The request body was not valid JSON.", code: "bad_request" }, { status: 400 });
  }
  const parsed = replyRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "The thread could not be read. Try reloading the page.", code: "bad_request" },
      { status: 400 },
    );
  }
  if (parsed.data.messages[parsed.data.messages.length - 1]?.from !== "them") {
    return Response.json(
      { error: "Add the salesperson's latest email before generating a reply.", code: "bad_request" },
      { status: 400 },
    );
  }

  const client = new Anthropic({ apiKey });
  try {
    const output = await generateReply(client, model, parsed.data);
    return Response.json({ reply: output.reply, update: output.registry, model });
  } catch (e) {
    if (e instanceof GenerationError) {
      return Response.json({ error: e.message, code: e.code }, { status: 502 });
    }
    return Response.json({ error: "Something went wrong generating the reply.", code: "internal" }, { status: 500 });
  }
}
