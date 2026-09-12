import { NextRequest, NextResponse } from "next/server";
import { generateReply, DEFAULT_MODELS, type LlmProvider } from "@/lib/llm";
import { getLlmConfig } from "@/lib/settings";

/**
 * Test the AI connection. If the form sends a key, we test with the form values
 * (so you can verify BEFORE saving). Otherwise we test the saved config.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    provider?: LlmProvider;
    api_key?: string;
    model?: string;
  };

  try {
    let cfg;
    if (body.api_key && body.provider) {
      cfg = {
        provider: body.provider,
        apiKey: body.api_key.trim(),
        model: body.model?.trim() || DEFAULT_MODELS[body.provider],
      };
    } else {
      cfg = await getLlmConfig();
    }

    const reply = await generateReply(
      cfg,
      "You are a helpful assistant. Reply in a few words only.",
      "Reply with exactly: connection ok",
    );
    return NextResponse.json({ ok: true, reply });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 200 });
  }
}
