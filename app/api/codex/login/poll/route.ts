import { NextRequest, NextResponse } from "next/server";
import { pollCodexLogin } from "../../../../../lib/codex-login-flow";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get("session_id") ?? "";

  if (!sessionId) {
    return NextResponse.json({ status: "error", error: "session_id가 필요합니다" }, { status: 400 });
  }

  const result = pollCodexLogin(sessionId);
  return NextResponse.json(result);
}
