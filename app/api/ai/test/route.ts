import { NextRequest, NextResponse } from "next/server";
import { testAiConnection, type AiSettings } from "../../../../lib/ai-edit";
import { isTrustedLocalRequest, UNTRUSTED_REQUEST_MESSAGE } from "../../../../lib/request-guard";

type RequestBody = {
  aiSettings?: AiSettings;
};

export async function POST(request: NextRequest) {
  if (!isTrustedLocalRequest(request.headers)) {
    return NextResponse.json({ ok: false, error: UNTRUSTED_REQUEST_MESSAGE }, { status: 403 });
  }
  try {
    const body = (await request.json()) as RequestBody;
    const result = await testAiConnection(body.aiSettings ?? { provider: "openai" });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
