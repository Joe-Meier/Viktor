import { DEFAULT_MODEL } from "./generate";

export const MISSING_KEY_MESSAGE =
  "No Anthropic API key is configured. Add ANTHROPIC_API_KEY to .env.local in the project folder, then restart the dev server.";

export function readConfig(env: Record<string, string | undefined> = process.env) {
  const apiKey = env.ANTHROPIC_API_KEY?.trim() || null;
  const model = env.ANTHROPIC_MODEL?.trim() || DEFAULT_MODEL;
  return { apiKey, model };
}
