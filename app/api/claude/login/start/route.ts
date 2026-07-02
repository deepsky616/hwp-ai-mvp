import { NextRequest, NextResponse } from "next/server";
import { startClaudeLogin } from "../../../../../lib/claude-auth";
import { isTrustedLocalRequest, UNTRUSTED_REQUEST_MESSAGE } from "../../../../../lib/request-guard";

export async function POST(request: NextRequest) {
  if (!isTrustedLocalRequest(request.headers)) {
    return NextResponse.json({ ok: false, error: UNTRUSTED_REQUEST_MESSAGE }, { status: 403 });
  }
  try {
    const body = await request.json().catch(() => ({}));
    const claudeCliPath = typeof body?.claudeCliPath === "string" ? body.claudeCliPath : undefined;
    const { authUrl, sessionId } = await startClaudeLogin(claudeCliPath);
    return NextResponse.json({ ok: true, authUrl, sessionId });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
