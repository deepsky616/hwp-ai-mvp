import { NextRequest, NextResponse } from "next/server";
import { startGeminiLogin } from "../../../../../lib/gemini-auth";
import { isTrustedLocalRequest, UNTRUSTED_REQUEST_MESSAGE } from "../../../../../lib/request-guard";

export async function POST(request: NextRequest) {
  if (!isTrustedLocalRequest(request.headers)) {
    return NextResponse.json({ error: UNTRUSTED_REQUEST_MESSAGE }, { status: 403 });
  }
  try {
    const result = await startGeminiLogin();
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "로그인 시작에 실패했습니다" },
      { status: 500 },
    );
  }
}
