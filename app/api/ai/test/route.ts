import { NextRequest, NextResponse } from "next/server";
import { testAiConnection, type AiSettings } from "../../../../lib/ai-edit";

type RequestBody = {
  aiSettings?: AiSettings;
};

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as RequestBody;
    const result = await testAiConnection(body.aiSettings ?? { provider: "openai" });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
