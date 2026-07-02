import { NextRequest, NextResponse } from "next/server";
import { pollClaudeLogin } from "../../../../../lib/claude-auth";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get("session_id") ?? "";

  if (!sessionId) {
    return NextResponse.json({ status: "error", error: "session_id가 필요합니다" }, { status: 400 });
  }

  return NextResponse.json(pollClaudeLogin(sessionId));
}
