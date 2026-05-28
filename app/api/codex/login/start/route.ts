import { NextRequest, NextResponse } from "next/server";
import { startCodexLogin } from "../../../../../lib/codex-login-flow";

export async function POST(_request: NextRequest) {
  try {
    const { authUrl, sessionId, userCode, interval } = await startCodexLogin();
    return NextResponse.json({ ok: true, authUrl, sessionId, userCode, interval });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
