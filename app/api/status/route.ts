import { readConfig, MISSING_KEY_MESSAGE } from "@/lib/config";

export const dynamic = "force-dynamic";

/** Lets the UI show a setup notice before the first generation attempt. */
export async function GET() {
  const { apiKey, model } = readConfig();
  return Response.json(
    apiKey ? { configured: true, model } : { configured: false, model, message: MISSING_KEY_MESSAGE },
  );
}
