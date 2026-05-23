import { NextRequest, NextResponse } from "next/server";
import { pollGeminiLoginCompletion } from "../../../../../lib/gemini-auth";

export async function GET(request: NextRequest) {
  const sessionId = new URL(request.url).searchParams.get("session_id") ?? "";
  if (!sessionId) {
    return NextResponse.json({ status: "error", error: "session_id가 필요합니다" }, { status: 400 });
  }
  return NextResponse.json(pollGeminiLoginCompletion(sessionId));
}
