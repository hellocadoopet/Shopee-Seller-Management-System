import { NextRequest, NextResponse } from "next/server";
import { getSettingsStatus, saveLlmConfig } from "@/lib/settings";
import { DEFAULT_MODELS, type LlmProvider } from "@/lib/llm";

const VALID: LlmProvider[] = ["claude", "openai", "deepseek"];

export async function GET() {
  const status = await getSettingsStatus();
  return NextResponse.json(status);
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    provider: LlmProvider;
    api_key?: string; // optional — only sent when changing the key
    model?: string;
  };

  if (!VALID.includes(body.provider)) {
    return NextResponse.json({ error: "invalid provider" }, { status: 400 });
  }

  const model = body.model?.trim() || DEFAULT_MODELS[body.provider];
  try {
    await saveLlmConfig(body.provider, body.api_key?.trim() || null, model);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
